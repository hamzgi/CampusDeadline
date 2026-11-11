import { NextResponse } from 'next/server';
import { authConfig, createAuthClient, isSameOriginPost } from '../../../lib/auth-server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const config = authConfig();
    if (!config) return new Response('로그인 준비 중입니다.', { status: 503 });
    if (!isSameOriginPost(request, config.appOrigin)) return new Response('Forbidden', { status: 403 });
    const supabase = await createAuthClient(config);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${config.appOrigin}/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error('Unable to begin sign-in');
    const destination = new URL(data.url);
    if (destination.origin !== config.supabaseOrigin || destination.pathname !== '/auth/v1/authorize') {
      throw new Error('Invalid authentication destination');
    }
    return NextResponse.redirect(destination, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('로그인을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.', { status: 503 });
  }
}
