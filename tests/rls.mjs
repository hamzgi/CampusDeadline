import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(await readFile('supabase/migrations/20261111005109_account_profiles.sql', 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2)', [a, b]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select current_user')).rows[0].current_user, 'authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
  await db.query('insert into public.account_profiles (user_id) values ($1) on conflict (user_id) do nothing', [a]);
  await db.query('insert into public.account_profiles (user_id) values ($1) on conflict (user_id) do nothing', [a]);
  await assert.rejects(db.query('insert into public.account_profiles (user_id) values ($1)', [b]), /row.level security/i);
  await assert.rejects(db.query('update public.account_profiles set user_id = $1 where user_id = $2', [b, a]), /permission denied/i);
  await assert.rejects(db.query('delete from public.account_profiles where user_id = $1', [a]), /permission denied/i);
  await assert.rejects(db.query('insert into public.account_profiles (user_id, created_at) values ($1, now())', [a]), /permission denied/i);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [b]);
  assert.deepEqual((await db.query('select user_id from public.account_profiles')).rows, []);
  await db.query('insert into public.account_profiles (user_id) values ($1)', [b]);
  assert.deepEqual((await db.query('select user_id from public.account_profiles')).rows, [{ user_id: b }]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
  assert.deepEqual((await db.query('select user_id from public.account_profiles')).rows, [{ user_id: a }]);

  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.account_profiles'), /permission denied/i);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as count from public.account_profiles')).rows[0].count, 2);
  console.log('PostgreSQL account RLS allowed own records and denied cross-user, anonymous, update, and delete access.');
} finally {
  await db.close();
}
