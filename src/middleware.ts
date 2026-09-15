import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple shared-password gate for the whole app (pages + API routes).
 *
 * Off by default: if APP_PASSWORD isn't set, every request passes through — this keeps
 * `npm run dev` friction-free before you've decided to protect a deployment. Set
 * APP_PASSWORD (and optionally APP_USERNAME, default "admin") to turn it on. Browsers
 * handle the HTTP Basic Auth challenge natively and then attach credentials to every
 * same-origin request automatically, including the app's own fetch() calls — so this
 * protects the UI and the API with one prompt, no login page to build.
 *
 * This is a deterrent for a personal tool on a public URL, not a compliance-grade
 * auth system: no rate limiting, no audit log, and Basic Auth sends credentials on
 * every request (fine over HTTPS, which Vercel terminates by default).
 */

const REALM = 'Trend Discovery';

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
  });
}

/** Decodes a "Basic <base64>" header without Buffer, which isn't available on the Edge runtime. */
function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    return NextResponse.next();
  }

  const expectedUsername = process.env.APP_USERNAME || 'admin';
  const credentials = parseBasicAuth(request.headers.get('authorization'));

  if (credentials && credentials.user === expectedUsername && credentials.pass === expectedPassword) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  // Everything except Next's own static assets — those carry no user data and gating
  // them can produce odd partially-authed page states.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
