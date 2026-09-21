// backend/src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const PREFIX = 'enc:v1:';

export function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'test') {
      return createHash('sha256').update('szamlazo-secure-test-encryption-key-for-vitest').digest();
    }
    throw new Error('❌ KRITIKUS HIBA: Az ENCRYPTION_KEY környezeti változó nincs beállítva! Az alkalmazás nem indulhat el nélküle.');
  }
  // Deterministically derive a 32-byte key
  return createHash('sha256').update(secret).digest();
}

/**
 * Szimmetrikus titkosítás AES-256-GCM algoritmussal.
 * Formátum: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encrypt(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '') {
    return null;
  }

  // Ha már titkosított, ne duplázzuk
  if (text.startsWith(PREFIX)) {
    return text;
  }

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err: any) {
    console.error('❌ Titkosítási hiba:', err.message);
    throw new Error('Nem sikerült titkosítani az adatot.');
  }
}

/**
 * Visszafejtés AES-256-GCM algoritmussal.
 * Visszafelé kompatibilis: ha nem 'enc:v1:' prefixszel kezdődik, változatlanul adja vissza (legacy plaintext).
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined || ciphertext === '') {
    return null;
  }

  // Nem titkosított szöveg (legacy plain text támogatás)
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 5) {
      console.warn('⚠️ Érvénytelen titkosított formátum, fallback eredetire');
      return ciphertext;
    }

    const [, , ivHex, tagHex, dataHex] = parts;
    if (!ivHex || !tagHex || !dataHex) {
      return ciphertext;
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encryptedData = Buffer.from(dataHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (err: any) {
    console.error('❌ Visszafejtési hiba (hibás kulcs vagy sérült adat):', err.message);
    return null;
  }
}
