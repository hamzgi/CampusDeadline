import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function checkedOrigin(value, label) {
  const url = new URL(value);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !isLocal) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid ${label} origin`);
  }
  return url.origin;
}

export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const appUrl = process.env.APP_BASE_URL;
  if (!url && !key && !appUrl) return null;
  if (!url || !key || !appUrl) throw new Error('Incomplete authentication configuration');
  return {
    supabaseOrigin: checkedOrigin(url, 'Supabase'),
    publishableKey: key,
    appOrigin: checkedOrigin(appUrl, 'application'),
  };
}

export async function createAuthClient(config) {
  const cookieStore = await cookies();
  return createServerClient(config.supabaseOrigin, config.publishableKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, {
            ...options,
            httpOnly: true,
            secure: config.appOrigin.startsWith('https://'),
            sameSite: 'lax',
            path: '/',
          });
        }
      },
    },
  });
}

export function isSameOriginPost(request, expectedOrigin) {
  const origin = request.headers.get('origin');
  if (origin) return origin === expectedOrigin;
  try { return new URL(request.headers.get('referer')).origin === expectedOrigin; }
  catch { return false; }
}
