// backend/src/middlewares/rate-limiter.ts
import type { MiddlewareHandler, Context } from 'hono';

export interface RateLimitOptions {
  windowMs: number; // Időablak ezredmásodpercben (pl. 60_000 = 1 perc)
  max: number;      // Megengedett maximális kérésszám az időablakban
  message?: string; // Egyedi hibaüzenet
  keyGenerator?: (c: Context) => string;
  skip?: (c: Context) => boolean;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Alapértelmezett kulcsgenerátor:
 * 1. Ha van Authorization Bearer token, a payloadból kinyert userId-t használja (user:<id>),
 *    így az irodai közös IP-t használók nem tiltják ki egymást, és proxy-val sem játszható ki.
 * 2. Hitelesítetlen kéréseknél IP-cím alapján azonosít (ip:<ip>).
 */
export function defaultRateLimitKeyGenerator(c: Context): string {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    try {
      const parts = token.split('.');
      if (parts.length === 3 && parts[1]) {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
        const payload = JSON.parse(payloadJson);
        if (payload && payload.id) {
          return `user:${payload.id}`;
        }
      }
    } catch {
      // Hibás token formátum esetén esünk vissza IP-re
    }
  }

  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]?.trim() : c.req.header('x-real-ip') || '127.0.0.1';
  return `ip:${ip || '127.0.0.1'}`;
}

/**
 * Memória-alapú sebességkorlátozó (Rate Limiter) middleware Hono keretrendszerhez.
 */
export function createRateLimiter(options: RateLimitOptions): MiddlewareHandler & { reset: () => void } {
  const {
    windowMs,
    max,
    message = 'Túl sok kérés érkezett. Kérjük, próbáld újra egy perc múlva!',
    keyGenerator = defaultRateLimitKeyGenerator,
    skip = () => false
  } = options;

  const hits = new Map<string, RateLimitRecord>();

  // Időszakos takarítás a memóriaszivárgás megelőzésére
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.max(windowMs, 30_000));

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (skip(c)) {
      return await next();
    }

    const key = keyGenerator(c);
    const now = Date.now();

    let record = hits.get(key);
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil(record.resetTime / 1000);

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    if (record.count > max) {
      const retryAfter = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          success: false,
          error: message,
        },
        429
      );
    }

    return await next();
  };

  const handler = middleware as MiddlewareHandler & { reset: () => void };
  handler.reset = () => {
    hits.clear();
  };

  return handler;
}
