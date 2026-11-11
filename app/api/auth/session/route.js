import { NextResponse } from 'next/server';
import { authConfig, createAuthClient } from '../../../../lib/auth-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };

export async function GET() {
  try {
    const config = authConfig();
    if (!config) return NextResponse.json({ configured: false, user: null }, { headers });
    const supabase = await createAuthClient(config);
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError' && error.status !== 401 && error.status !== 403) throw error;
    const user = data?.user ? { id: data.user.id, email: data.user.email || '' } : null;
    return NextResponse.json({ configured: true, user }, { headers });
  } catch {
    return NextResponse.json({ error: '인증 상태를 확인할 수 없습니다.' }, { status: 503, headers });
  }
}
