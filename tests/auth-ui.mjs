import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:3147').origin;
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : undefined);
const userA = { id: '11111111-1111-4111-8111-111111111111', email: 'student-a@example.test' };
const userB = { id: '22222222-2222-4222-8222-222222222222', email: 'student-b@example.test' };
const assignment = title => [{ id: title, title, course: '테스트 과목', due: '2035-11-13T23:59', status: 'open' }];
let state = { configured: false, user: null };
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/api/auth/session', async route => {
    if (state.error) await route.fulfill({ status: 503, json: { error: 'unavailable' } });
    else await route.fulfill({ json: state });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#attentionTitle')?.textContent.includes('동기화'));
  await page.evaluate(({ a, b, values }) => {
    localStorage.setItem('jungbu-task-board-v2', JSON.stringify(values.legacy));
    localStorage.setItem(`jungbu-task-board-account-${a.id}-v1`, JSON.stringify(values.a));
    localStorage.setItem(`jungbu-task-board-account-${b.id}-v1`, JSON.stringify(values.b));
  }, { a: userA, b: userB, values: { legacy: assignment('기존 기기 과제'), a: assignment('A의 과제'), b: assignment('B의 과제') } });

  state = { configured: true, user: userA };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('A의 과제').first().waitFor();
  assert.equal(await page.getByText('B의 과제').count(), 0);
  assert.equal(await page.getByText('기존 기기 과제').count(), 0);
  assert.equal(await page.locator('#accountControl form').getAttribute('action'), '/auth/logout');

  const oldPayload = { assignments: [{ title: '이전 사용자 동기화', course: '테스트 과목', due: '2035-11-13T23:59', status: 'open' }], syncedAt: '2026-01-01T00:00:00.000Z' };
  await page.evaluate(payload => window.postMessage({ source: 'jungbu-lms-sync', type: 'LMS_SYNC_DATA', payload }, location.origin), oldPayload);
  assert.equal(await page.getByText('이전 사용자 동기화').count(), 0);
  await page.locator('#openSync').click();
  await page.evaluate(payload => window.postMessage({ source: 'jungbu-lms-sync', type: 'LMS_SYNC_DATA', payload: { ...payload, syncedAt: new Date().toISOString() } }, location.origin), oldPayload);
  await page.getByText('이전 사용자 동기화').first().waitFor();
  assert.equal(await page.getByText('A의 과제').count() > 0, true);

  state = { configured: true, user: userB };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('B의 과제').first().waitFor();
  assert.equal(await page.getByText('A의 과제').count(), 0);
  assert.equal(await page.getByText('이전 사용자 동기화').count(), 0);
  await page.evaluate(payload => window.postMessage({ source: 'jungbu-lms-sync', type: 'LMS_SYNC_DATA', payload }, location.origin), oldPayload);
  assert.equal(await page.getByText('이전 사용자 동기화').count(), 0);

  state = { configured: true, user: null };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Google로 계속하기' }).waitFor();
  assert.equal(await page.locator('.app-shell').isHidden(), true);
  assert.equal(await page.locator('.auth-screen form').getAttribute('action'), '/auth/login');
  assert.equal(await page.getByText('기존 기기 과제').isVisible(), false);
  assert.equal(await page.getByText('B의 과제').isVisible(), false);

  state = { error: true };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('로그인 상태를 확인하지 못했습니다.', { exact: false }).waitFor();
  assert.equal(await page.locator('.app-shell').isHidden(), true);
  assert.deepEqual(errors, []);
  console.log('Account-scoped local views, stale sync rejection, and session failure behavior passed.');
} finally {
  await browser.close();
}
