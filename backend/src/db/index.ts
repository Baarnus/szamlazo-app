// backend/src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ Figyelem: DATABASE_URL hiányzik a környezeti változókból!');
}

const client = postgres(connectionString || '', { max: 10 });
export const db = drizzle(client, { schema });

export async function initDatabase() {
  if (!connectionString) return;
  try {
    // 1. Users tábla létrehozása
    await client`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'free',
        monthly_credits INTEGER NOT NULL DEFAULT 15,
        szamlazz_hu_api_key TEXT,
        nav_technical_user TEXT,
        nav_technical_password TEXT,
        nav_sign_key TEXT,
        nav_exchange_key TEXT,
        reset_token TEXT,
        reset_token_expiry TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // Új oszlopok hozzáadása meglévő adatbázishoz (ALTER TABLE IF NOT EXISTS)
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS szamlazz_hu_api_key TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_technical_user TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_technical_password TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_sign_key TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_exchange_key TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_tax_number TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP;`;

    // 2. Invoices tábla létrehozása (user_id hivatkozással)
    await client`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        image_url TEXT,
        source TEXT,
        data JSONB NOT NULL,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        is_deleted BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'processed',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // Hiányzó oszlop hozzáadása a meglévő invoices táblához
    await client`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;`;

    // 3. Audit logs tábla létrehozása
    await client`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // 4. Payments tábla létrehozása (Stripe idempotency)
    await client`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        stripe_session_id TEXT NOT NULL UNIQUE,
        credits_added INTEGER NOT NULL,
        package_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // 5. Worksheets (MesterMunkalap) tábla létrehozása
    await client`
      CREATE TABLE IF NOT EXISTS worksheets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        worksheet_number TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_tax_number TEXT,
        client_zip TEXT,
        client_city TEXT,
        client_address TEXT,
        client_email TEXT,
        client_phone TEXT,
        device_type TEXT,
        description TEXT NOT NULL DEFAULT '',
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        before_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
        after_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
        signature_url TEXT,
        signed_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'draft',
        invoice_id TEXT REFERENCES invoices(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // 6. Indexek létrehozása a lekérdezések gyorsításához
    await client`
      CREATE INDEX IF NOT EXISTS idx_invoices_user_active ON invoices (user_id, is_deleted, created_at DESC);
    `;
    await client`
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);
    `;
    await client`
      CREATE INDEX IF NOT EXISTS idx_worksheets_user_status ON worksheets (user_id, status, created_at DESC);
    `;

    console.log('✅ [PostgreSQL] Összes tábla és index ellenőrizve / inicializálva (users, invoices, audit_logs, payments, worksheets).');
  } catch (err: any) {
    console.error('❌ [PostgreSQL] Adatbázis inicializálási hiba:', err.message);
  }
}