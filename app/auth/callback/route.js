import { NextResponse } from 'next/server';
import { authConfig, createAuthClient } from '../../../lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  let config;
  let supabase;
  let sessionCreated = false;
  try {
    config = authConfig();
    if (!config) return new Response('로그인 준비 중입니다.', { status: 503 });
    const code = new URL(request.url).searchParams.get('code');
    if (!code || code.length > 2048) throw new Error('Missing authorization code');
    supabase = await createAuthClient(config);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    sessionCreated = true;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) throw new Error('Unable to verify user');
    const { error: profileError } = await supabase.from('account_profiles')
      .upsert({ user_id: data.user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (profileError) throw new Error('Unable to initialize account');
    return NextResponse.redirect(`${config.appOrigin}/`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    if (sessionCreated && supabase) {
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Clear the local session where possible. */ }
    }
    if (!config) return new Response('로그인 설정을 확인할 수 없습니다.', { status: 503 });
    return NextResponse.redirect(`${config.appOrigin}/?auth_error=1`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  }
}
