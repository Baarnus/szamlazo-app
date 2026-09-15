import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';

describe('API Végpontok (Hono)', () => {
  it('GET /api/invoices - 401 hibát kell adnia Authorization header nélkül', async () => {
    // Hono app.request() segítségével szerver indítás nélkül tesztelhetjük a routing-ot!
    const req = new Request('http://localhost/api/invoices', {
      method: 'GET',
    });
    
    const res = await app.request(req);
    
    expect(res.status).toBe(401);
    
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Nincs bejelentkezve.');
  });

  it('GET /api/settings - 401 hibát kell adnia auth nélkül', async () => {
    const req = new Request('http://localhost/api/settings');
    const res = await app.request(req);
    
    expect(res.status).toBe(401);
  });
});
