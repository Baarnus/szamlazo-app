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

// Automatikus önfelépítés: ha még nincs tábla, induláskor létrehozza
export async function initDatabase() {
  if (!connectionString) return;
  try {
    await client`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        image_url TEXT,
        source TEXT,
        data JSONB NOT NULL,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        status TEXT NOT NULL DEFAULT 'processed',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    console.log('✅ [PostgreSQL] Invoices tábla ellenőrizve / sikeresen inicializálva.');
  } catch (err: any) {
    console.error('❌ [PostgreSQL] Nem sikerült inicializálni a táblát:', err.message);
  }
}