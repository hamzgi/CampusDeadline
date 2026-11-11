import { NextResponse } from 'next/server';
import { authConfig, createAuthClient, isSameOriginPost } from '../../../lib/auth-server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const config = authConfig();
    if (!config) return new Response('로그인 준비 중입니다.', { status: 503 });
    if (!isSameOriginPost(request, config.appOrigin)) return new Response('Forbidden', { status: 403 });
    const supabase = await createAuthClient(config);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    return NextResponse.redirect(`${config.appOrigin}/`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.', { status: 503 });
  }
}
