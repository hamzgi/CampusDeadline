import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { request as playwrightRequest } from 'playwright';

const appOrigin = 'http://localhost:3148';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'student@gmail.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock-signature`;
let expectedChallenge;
let tokenRequests = 0;
let rejectProfile = false;
let rejectUser = false;
let profileWrites = 0;
const mockSupabase = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* no JSON body */ }
  const json = (status, value) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    tokenRequests += 1;
    const challenge = createHash('sha256').update(body.code_verifier || '').digest('base64url');
    if (body.auth_code !== 'valid-code' || challenge !== expectedChallenge) return json(400, { msg: 'Invalid PKCE verifier' });
    return json(200, { access_token: accessToken, refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user });
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    if (rejectUser) return json(503, { message: 'Temporarily unavailable' });
    if (req.headers.authorization !== `Bearer ${accessToken}`) return json(401, { message: 'Invalid token' });
    return json(200, user);
  }
  if (url.pathname === '/rest/v1/account_profiles' && req.method === 'POST') {
    if (req.headers.authorization !== `Bearer ${accessToken}` || body.user_id !== user.id) return json(403, { message: 'Forbidden' });
    if (rejectProfile) return json(403, { message: 'RLS denied' });
    profileWrites += 1;
    return res.writeHead(201, { 'Content-Type': 'application/json' }).end('[]');
  }
  if (url.pathname === '/auth/v1/logout' && req.method === 'POST') return res.writeHead(204).end();
  return json(404, { message: 'Not found' });
});
await new Promise(resolve => mockSupabase.listen(0, '127.0.0.1', resolve));
const supabaseOrigin = `http://127.0.0.1:${mockSupabase.address().port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3148'], {
  cwd: process.cwd(),
  env: { ...process.env, SUPABASE_URL: supabaseOrigin, SUPABASE_PUBLISHABLE_KEY: 'mock-publishable-key', APP_BASE_URL: appOrigin },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let requestContext;
try {
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${appOrigin}/api/auth/session`)).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(200);
  }
  assert(ready, 'test server did not start');
  requestContext = await playwrightRequest.newContext({ baseURL: appOrigin });
  const signedOut = await requestContext.get('/api/auth/session');
  assert.deepEqual(await signedOut.json(), { configured: true, user: null });
  assert((signedOut.headers()['cache-control'] || '').includes('no-store'));
  assert.equal((await requestContext.post('/auth/login', { headers: { Origin: 'https://attacker.example' }, maxRedirects: 0 })).status(), 403);
  assert.equal((await requestContext.post('/auth/logout', { headers: { Origin: 'https://attacker.example' }, maxRedirects: 0 })).status(), 403);

  const startLogin = async () => {
    const start = await requestContext.post('/auth/login', { headers: { Origin: appOrigin }, maxRedirects: 0 });
    assert.equal(start.status(), 303);
    const authorize = new URL(start.headers().location);
    assert.equal(authorize.origin, supabaseOrigin);
    assert.equal(authorize.searchParams.get('provider'), 'google');
    assert.equal(authorize.searchParams.get('redirect_to'), `${appOrigin}/auth/callback`);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
    expectedChallenge = authorize.searchParams.get('code_challenge');
    assert(expectedChallenge);
    const state = await requestContext.storageState();
    assert(state.cookies.some(cookie => cookie.name.includes('code-verifier') && cookie.httpOnly));
  };

  const noVerifier = await requestContext.get('/auth/callback?code=valid-code', { maxRedirects: 0 });
  assert.equal(noVerifier.status(), 303);
  assert.equal(noVerifier.headers().location, `${appOrigin}/?auth_error=1`);
  assert.equal(tokenRequests, 0);

  await startLogin();
  const callback = await requestContext.get('/auth/callback?code=valid-code&next=https://attacker.example/', { maxRedirects: 0 });
  assert.equal(callback.status(), 303);
  assert.equal(callback.headers().location, `${appOrigin}/`);
  assert.equal(profileWrites, 1);
  const signedIn = await requestContext.get('/api/auth/session');
  assert.deepEqual(await signedIn.json(), { configured: true, user: { id: user.id, email: user.email } });
  assert((await requestContext.storageState()).cookies.filter(cookie => cookie.name.includes('auth-token')).every(cookie => cookie.httpOnly));

  const tamperedContext = await playwrightRequest.newContext({ baseURL: appOrigin });
  const cookie = (await requestContext.storageState()).cookies.find(item => item.name.endsWith('-auth-token'));
  assert(cookie?.value.startsWith('base64-'));
  const session = JSON.parse(Buffer.from(cookie.value.slice(7), 'base64url').toString());
  session.access_token = `${encode({ alg: 'none' })}.${encode({ sub: '22222222-2222-4222-8222-222222222222', exp: Math.floor(Date.now() / 1000) + 3600 })}.forged`;
  cookie.value = `base64-${encode(session)}`;
  await tamperedContext.addCookies([cookie]);
  assert.deepEqual(await (await tamperedContext.get('/api/auth/session')).json(), { configured: true, user: null });
  await tamperedContext.dispose();

  const logout = await requestContext.post('/auth/logout', { headers: { Origin: appOrigin }, maxRedirects: 0 });
  assert.equal(logout.status(), 303);
  assert.deepEqual(await (await requestContext.get('/api/auth/session')).json(), { configured: true, user: null });

  rejectProfile = true;
  await startLogin();
  const rejected = await requestContext.get('/auth/callback?code=valid-code', { maxRedirects: 0 });
  assert.equal(rejected.headers().location, `${appOrigin}/?auth_error=1`);
  assert.deepEqual(await (await requestContext.get('/api/auth/session')).json(), { configured: true, user: null });
  rejectProfile = false;
  rejectUser = true;
  await startLogin();
  const failedVerification = await requestContext.get('/auth/callback?code=valid-code', { maxRedirects: 0 });
  assert.equal(failedVerification.headers().location, `${appOrigin}/?auth_error=1`);
  rejectUser = false;
  assert.deepEqual(await (await requestContext.get('/api/auth/session')).json(), { configured: true, user: null });
  console.log('Google PKCE initiation, verified session, CSRF checks, safe redirects, logout, and profile failure behavior passed with a mock Supabase service.');
} finally {
  if (requestContext) await requestContext.dispose();
  child.kill();
  await new Promise(resolve => mockSupabase.close(resolve));
}
