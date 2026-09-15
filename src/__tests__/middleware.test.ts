import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const basicAuthHeader = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const requestWith = (headers?: Record<string, string>) =>
  new NextRequest('http://localhost:3000/api/watchlist', { headers });

describe('App password gate (middleware)', () => {
  const originalUser = process.env.APP_USERNAME;
  const originalPass = process.env.APP_PASSWORD;

  afterEach(() => {
    if (originalUser === undefined) delete process.env.APP_USERNAME;
    else process.env.APP_USERNAME = originalUser;
    if (originalPass === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = originalPass;
  });

  describe('when APP_PASSWORD is not set', () => {
    beforeEach(() => {
      delete process.env.APP_USERNAME;
      delete process.env.APP_PASSWORD;
    });

    it('passes every request through unauthenticated', () => {
      const response = middleware(requestWith());
      expect(response.status).toBe(200); // NextResponse.next() reports 200 by default
    });
  });

  describe('when APP_PASSWORD is set', () => {
    beforeEach(() => {
      process.env.APP_PASSWORD = 'secret123';
      delete process.env.APP_USERNAME; // should default to "admin"
    });

    it('returns 401 with a WWW-Authenticate header when no credentials are sent', () => {
      const response = middleware(requestWith());
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('returns 401 for wrong credentials', () => {
      const response = middleware(requestWith({ authorization: basicAuthHeader('admin', 'wrong') }));
      expect(response.status).toBe(401);
    });

    it('passes through for the default "admin" username with the correct password', () => {
      const response = middleware(requestWith({ authorization: basicAuthHeader('admin', 'secret123') }));
      expect(response.status).toBe(200);
    });

    it('respects a custom APP_USERNAME', () => {
      process.env.APP_USERNAME = 'jeff';
      expect(middleware(requestWith({ authorization: basicAuthHeader('admin', 'secret123') })).status).toBe(401);
      expect(middleware(requestWith({ authorization: basicAuthHeader('jeff', 'secret123') })).status).toBe(200);
    });

    it('returns 401 for a malformed Authorization header instead of throwing', () => {
      const response = middleware(requestWith({ authorization: 'Basic not-valid-base64!!' }));
      expect(response.status).toBe(401);
    });
  });
});
