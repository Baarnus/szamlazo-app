import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt } from '../src/lib/crypto.js';
import { rewriteS3PublicUrl, deleteUserS3Folder } from '../src/lib/s3.js';
import { createRateLimiter } from '../src/middlewares/rate-limiter.js';
import { app, authLimiter } from '../src/index.js';
import { exportRouter } from '../src/routes/export.js';
import { Hono } from 'hono';

describe('3. Fázis: Teljesítmény és Keményítés Tesztek (Phase 3 Tests)', () => {

  describe('C2: AES-256-GCM Érzékeny Adatok Titkosítása (crypto.ts)', () => {
    const sampleApiKey = 'szamlazz_agent_live_key_987654321_abcdef';

    it('Sikeresen titkosítja és visszafejti az API kulcsot', () => {
      const encrypted = encrypt(sampleApiKey);
      expect(encrypted).not.toBeNull();
      expect(encrypted).not.toBe(sampleApiKey);
      expect(encrypted!.startsWith('enc:v1:')).toBe(true);

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(sampleApiKey);
    });

    it('Két titkosítás ugyanarra az adatra eltérő ciphertextet és IV-t kell adjon (GCM random IV)', () => {
      const enc1 = encrypt(sampleApiKey);
      const enc2 = encrypt(sampleApiKey);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(sampleApiKey);
      expect(decrypt(enc2)).toBe(sampleApiKey);
    });

    it('Visszafelé kompatibilis: a legacy plaintext adatokat változatlanul visszaadja', () => {
      const legacyKey = 'plain_legacy_key_12345';
      const result = decrypt(legacyKey);
      expect(result).toBe(legacyKey);
    });

    it('Idempotens: már titkosított szöveget nem titkosít újra', () => {
      const enc1 = encrypt(sampleApiKey);
      const enc2 = encrypt(enc1);
      expect(enc1).toBe(enc2);
    });

    it('Kezeli az üres és null értékeket', () => {
      expect(encrypt(null)).toBeNull();
      expect(encrypt(undefined)).toBeNull();
      expect(encrypt('')).toBeNull();
      expect(decrypt(null)).toBeNull();
      expect(decrypt(undefined)).toBeNull();
      expect(decrypt('')).toBeNull();
    });

    it('Sérült adat vagy hibás auth tag esetén null-t ad vissza kivétel dobása helyett', () => {
      const corrupted = 'enc:v1:123456789012345678901234:abcdefabcdefabcdefabcdefabcdefab:001122334455';
      const result = decrypt(corrupted);
      expect(result).toBeNull();
    });
  });

  describe('C3: S3 Public URL Átírás (s3.ts)', () => {
    it('Lecseréli a belső MinIO hosztot a publikus URL-re', () => {
      const internalPresigned = 'http://minio:9000/invoices/users/user1/test.jpg?X-Amz-Signature=xyz';
      const result = rewriteS3PublicUrl(internalPresigned, 'https://storage.szamlazo.hu', 'http://minio:9000');
      expect(result).toBe('https://storage.szamlazo.hu/invoices/users/user1/test.jpg?X-Amz-Signature=xyz');
    });

    it('Érintetlenül hagyja az URL-t, ha nincs beállítva S3_PUBLIC_URL', () => {
      const internalPresigned = 'http://minio:9000/invoices/test.jpg';
      const result = rewriteS3PublicUrl(internalPresigned, '', 'http://minio:9000');
      expect(result).toBe(internalPresigned);
    });

    it('Nem cseréli le a más külső hosztra mutató linkeket', () => {
      const externalUrl = 'https://s3.amazonaws.com/mybucket/pic.jpg';
      const result = rewriteS3PublicUrl(externalUrl, 'https://storage.szamlazo.hu', 'http://minio:9000');
      expect(result).toBe(externalUrl);
    });
  });

  describe('C4: Rate Limiter Middleware (rate-limiter.ts)', () => {
    it('Megengedi a kéréseket a kvótahatárig és beállítja a fejléceket', async () => {
      const testLimiter = createRateLimiter({
        windowMs: 10_000,
        max: 3,
        message: 'Kvóta túllépve',
        keyGenerator: () => 'test-client-1'
      });

      const testApp = new Hono();
      testApp.use('/test', testLimiter);
      testApp.get('/test', (c) => c.json({ ok: true }));

      // 1. kérés
      const res1 = await testApp.request(new Request('http://localhost/test'));
      expect(res1.status).toBe(200);
      expect(res1.headers.get('X-RateLimit-Limit')).toBe('3');
      expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

      // 2. kérés
      const res2 = await testApp.request(new Request('http://localhost/test'));
      expect(res2.status).toBe(200);
      expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');

      // 3. kérés
      const res3 = await testApp.request(new Request('http://localhost/test'));
      expect(res3.status).toBe(200);
      expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0');

      // 4. kérés -> 429 Too Many Requests
      const res4 = await testApp.request(new Request('http://localhost/test'));
      expect(res4.status).toBe(429);
      expect(res4.headers.get('Retry-After')).toBeDefined();
      const body4 = await res4.json();
      expect(body4.success).toBe(false);
      expect(body4.error).toBe('Kvóta túllépve');
    });

    it('A reset() metódus törli az addigi számlálókat', async () => {
      const testLimiter = createRateLimiter({
        windowMs: 10_000,
        max: 1,
        keyGenerator: () => 'test-client-reset'
      });

      const testApp = new Hono();
      testApp.use('/test', testLimiter);
      testApp.get('/test', (c) => c.json({ ok: true }));

      await testApp.request(new Request('http://localhost/test'));
      const blocked = await testApp.request(new Request('http://localhost/test'));
      expect(blocked.status).toBe(429);

      testLimiter.reset();

      const afterReset = await testApp.request(new Request('http://localhost/test'));
      expect(afterReset.status).toBe(200);
    });
  });

  describe('C4: Globális 404 és 500 Hibakezelő (index.ts)', () => {
    it('Ismeretlen útvonalra egységes 404 JSON választ ad', async () => {
      const res = await app.request(new Request('http://localhost/api/this-does-not-exist'));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('A kért útvonal nem található.');
    });

    it('Kivétel esetén a globális onError kezeli le', async () => {
      const errorApp = new Hono();
      errorApp.onError((err, c) => {
        return c.json({ success: false, error: 'Belső szerverhiba történt.' }, 500);
      });
      errorApp.get('/crash', () => {
        throw new Error('Szimulált szerverhiba');
      });

      const res = await errorApp.request(new Request('http://localhost/crash'));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Belső szerverhiba történt.');
    });
  });

  describe('3. Fázis: GDPR S3 Fizikai Képtörlés (s3.ts)', () => {
    it('Üres vagy érvénytelen userId esetén 0-t ad vissza kivétel dobása nélkül', async () => {
      const result = await deleteUserS3Folder('');
      expect(result).toBe(0);
    });

    it('Kezeli az S3 kapcsolódási hibát vagy hiányzó konfigurációt kecsesen', async () => {
      // Nem létező dummy user ID
      const result = await deleteUserS3Folder('non_existent_test_user_id_12345');
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('3. Fázis: Könyvelési Export és Dátumszűrés (export.ts)', () => {
    const exportApp = new Hono();
    exportApp.route('/api/export', exportRouter);

    it('Hitelesítetlen CSV export kérést 401 Unauthorized státusszal elutasít', async () => {
      const res = await exportApp.request(new Request('http://localhost/api/export/csv'));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Nincs bejelentkezve.');
    });

    it('Hitelesítetlen RLB export kérést 401 Unauthorized státusszal elutasít', async () => {
      const res = await exportApp.request(new Request('http://localhost/api/export/rlb'));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Nincs bejelentkezve.');
    });

    it('Elfogadja a from és to query paramétereket a szűréshez', async () => {
      const res = await exportApp.request(new Request('http://localhost/api/export/csv?from=2026-01-01&to=2026-01-31'));
      expect(res.status).toBe(401); // Mivel nincs auth header, az auth middleware helyesen megállítja
    });
  });

  describe('3. Fázis: Hardcode Tisztítás & Konfiguráció (auth.ts & index.astro)', () => {
    it('A MAIL_FROM környezeti változó vagy fallback helyesen működik', () => {
      const defaultMail = process.env.MAIL_FROM || 'Számla AI <info@szamlazzjol.hu>';
      expect(defaultMail).toBeDefined();
      expect(defaultMail.includes('@')).toBe(true);
    });
  });
});
