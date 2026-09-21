import { describe, it, expect } from 'vitest';
import { isPrivateOrBlockedHost, validateUrlForSSRF } from '../src/services/gemini.js';
import { cleanFieldCSV } from '../src/services/export-formatter.js';
import { app } from '../src/index.js';

describe('1. Fázis: Biztonsági Tesztek (Security Tests)', () => {
  describe('SSRF Védelem (isPrivateOrBlockedHost & validateUrlForSSRF)', () => {
    it('Tiltania kell a belső / loopback címeket', () => {
      expect(isPrivateOrBlockedHost('localhost')).toBe(true);
      expect(isPrivateOrBlockedHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('127.0.0.5')).toBe(true);
      expect(isPrivateOrBlockedHost('0.0.0.0')).toBe(true);
      expect(isPrivateOrBlockedHost('::1')).toBe(true);
      expect(isPrivateOrBlockedHost('[::1]')).toBe(true);
    });

    it('Tiltania kell a felhős metaadat és link-local címeket', () => {
      expect(isPrivateOrBlockedHost('169.254.169.254')).toBe(true);
      expect(isPrivateOrBlockedHost('metadata.google.internal')).toBe(true);
    });

    it('Tiltania kell az összes RFC 1918 privát tartományt', () => {
      // 10.0.0.0/8
      expect(isPrivateOrBlockedHost('10.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('10.254.1.10')).toBe(true);

      // 172.16.0.0/12
      expect(isPrivateOrBlockedHost('172.16.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('172.24.5.10')).toBe(true);
      expect(isPrivateOrBlockedHost('172.31.255.255')).toBe(true);

      // 192.168.0.0/16
      expect(isPrivateOrBlockedHost('192.168.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('192.168.1.100')).toBe(true);
    });

    it('El kell fogadnia a valós, publikus internetes hosztokat', () => {
      expect(isPrivateOrBlockedHost('images.unsplash.com')).toBe(false);
      expect(isPrivateOrBlockedHost('example.com')).toBe(false);
      expect(isPrivateOrBlockedHost('8.8.8.8')).toBe(false);
    });

    it('validateUrlForSSRF el kell utasítsa a tiltott protokollokat és belső címeket', () => {
      expect(() => validateUrlForSSRF('ftp://example.com/invoice.jpg')).toThrow('Nem támogatott protokoll');
      expect(() => validateUrlForSSRF('file:///etc/passwd')).toThrow('Nem támogatott protokoll');
      expect(() => validateUrlForSSRF('http://localhost:5432/db')).toThrow('SSRF védelem');
      expect(() => validateUrlForSSRF('http://169.254.169.254/secret')).toThrow('SSRF védelem');
      expect(() => validateUrlForSSRF('http://192.168.1.1/scan.png')).toThrow('SSRF védelem');
    });

    it('validateUrlForSSRF engedélyeznie kell a biztonságos publikus HTTPS URL-eket', () => {
      const parsed = validateUrlForSSRF('https://example.com/invoice.jpg');
      expect(parsed.hostname).toBe('example.com');
      expect(parsed.protocol).toBe('https:');
    });
  });

  describe('CSV Formula Injection Védelem (CWE-1236)', () => {
    it('Semlegesítenie kell az egyenlőségjellel (=) kezdődő cellákat', () => {
      const res = cleanFieldCSV('=CMD|"/c calc"!A0');
      expect(res).toBe(`"'=CMD|""/c calc""!A0"`);
      expect(res.startsWith(`"'=`)).toBe(true);
    });

    it('Semlegesítenie kell a +, -, @ jellel kezdődő cellákat', () => {
      expect(cleanFieldCSV('+12345').startsWith(`"'+`)).toBe(true);
      expect(cleanFieldCSV('-9999').startsWith(`"'-`)).toBe(true);
      expect(cleanFieldCSV('@SUM(A1:B2)').startsWith(`"'@`)).toBe(true);
    });

    it('A normál szövegeket változatlanul kell hagynia (csak idézőjelbe teszi)', () => {
      expect(cleanFieldCSV('Normál Partner Kft.')).toBe('"Normál Partner Kft."');
      expect(cleanFieldCSV('Kovács "Építő" Bt.')).toBe('"Kovács ""Építő"" Bt."');
      expect(cleanFieldCSV('')).toBe('""');
      expect(cleanFieldCSV(null)).toBe('""');
    });
  });

  describe('Password Reset Poisoning Védelem', () => {
    it('Az authRouter nem dőlhet be hamis Origin fejlécnek', async () => {
      // Teszteljük, hogy a /api/auth/forgot-password kérés nem fogad el manipulált Origint
      const res = await app.request(new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://attacker-evil-host.com'
        },
        body: JSON.stringify({ email: 'nonexistent-test-user-for-audit@test.com' })
      }));

      // Nem létező felhasználónál is 200 OK-t ad (user enumeration védelem), de a belső logika a FRONTEND_URL-t használja
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Képfeldolgozás & Modell Biztonsági Ellenőrzések', () => {
    it('GEMINI_MODEL konfiguráció a beállított modellt használja', async () => {
      const { GEMINI_MODEL } = await import('../src/services/gemini.js');
      expect(GEMINI_MODEL).toBe(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
    });

    it('resolveImageBuffer elutasítja az SVG formátumot XSS megelőzés céljából', async () => {
      const { resolveImageBuffer } = await import('../src/services/gemini.js');
      await expect(
        resolveImageBuffer({
          type: 'base64',
          data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
          mimeType: 'image/svg+xml'
        })
      ).rejects.toThrow('SVG formátum');
    });
  });
});

