import { Hono } from 'hono';
import Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { getAuthUser } from './auth.js';

export const billingRouter = new Hono();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-08-26.dahlia' as any,
});

export const CREDIT_PACKAGES: Record<string, { name: string; credits: number; priceHuf: number }> = {
  starter: {
    name: 'Kezdő Csomag (50 kredit)',
    credits: 50,
    priceHuf: 2990,
  },
  pro: {
    name: 'Pro Csomag (150 kredit)',
    credits: 150,
    priceHuf: 6990,
  },
  business: {
    name: 'Üzleti Csomag (500 kredit)',
    credits: 500,
    priceHuf: 17990,
  },
};

// Checkout Session generálása
billingRouter.post('/create-checkout-session', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Kérlek jelentkezz be a vásárláshoz!' }, 401);
  }

  try {
    const { packageId } = await c.req.json<{ packageId: string }>();
    const selectedPkg = CREDIT_PACKAGES[packageId];

    if (!selectedPkg) {
      return c.json({ success: false, error: 'Érvénytelen csomag.' }, 400);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4321';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        packageId: packageId,
        creditsToAdd: String(selectedPkg.credits),
      },
      line_items: [
        {
          price_data: {
            currency: 'huf',
            product_data: {
              name: `SzamlazzJol - ${selectedPkg.name}`,
              description: `${selectedPkg.credits} számla AI feldolgozása`,
            },
            unit_amount: selectedPkg.priceHuf * 100, // HUF fillérben
          },
          quantity: 1,
        },
      ],
      // Átadjuk a session_id paramétert a visszatéréshez
      success_url: `${frontendUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}&credits=${selectedPkg.credits}`,
      cancel_url: `${frontendUrl}/?payment=cancelled`,
    });

    return c.json({ success: true, url: session.url });
  } catch (err: any) {
    console.error('Stripe hiba:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Fizetési munkamenet ellenőrzése és jóváírása (Frontend visszatéréskor azonnal)
billingRouter.post('/verify-session', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nem azonosított felhasználó' }, 401);
  }

  try {
    const { sessionId } = await c.req.json<{ sessionId: string }>();
    if (!sessionId) {
      return c.json({ success: false, error: 'Hiányzó sessionId' }, 400);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Csak kifizetett és a felhasználóhoz tartozó session-t fogadunk el
    if (session.payment_status === 'paid' && (session.metadata?.userId === user.id || session.client_reference_id === user.id)) {
      const creditsToAdd = Number(session.metadata?.creditsToAdd || 0);

      if (creditsToAdd > 0) {
        await db.update(users)
          .set({
            monthlyCredits: sql`${users.monthlyCredits} + ${creditsToAdd}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }

      const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));

      return c.json({
        success: true,
        credits: updatedUser?.monthlyCredits ?? 0,
      });
    }

    return c.json({ success: false, error: 'A tranzakció még nem fejeződött be sikeresen.' }, 400);
  } catch (err: any) {
    console.error('Session ellenőrzési hiba:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Webhook a háttérbeli aszinkron jóváíráshoz
billingRouter.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return c.text('Hiányzó signature vagy secret', 400);
  }

  try {
    const rawBody = await c.req.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId || session.client_reference_id;
      const creditsToAdd = Number(session.metadata?.creditsToAdd || 0);

      if (userId && creditsToAdd > 0) {
        await db.update(users)
          .set({
            monthlyCredits: sql`${users.monthlyCredits} + ${creditsToAdd}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    }

    return c.json({ received: true });
  } catch (err: any) {
    return c.text(`Webhook Error: ${err.message}`, 400);
  }
});