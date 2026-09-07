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
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;

    // 2. Invoices tábla létrehozása (user_id hivatkozással)
    await client`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        image_url TEXT,
        source TEXT,
        data JSONB NOT NULL,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        status TEXT NOT NULL DEFAULT 'processed',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    console.log('✅ [PostgreSQL] Users és Invoices táblák ellenőrizve / inicializálva.');
  } catch (err: any) {
    console.error('❌ [PostgreSQL] Adatbázis inicializálási hiba:', err.message);
  }
}