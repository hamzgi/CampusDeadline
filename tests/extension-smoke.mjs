import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3147';
const origin = new URL(baseUrl).origin;
const response = await fetch(`${origin}/lms-sync-extension.zip`);
assert.equal(response.status, 200);
const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
const tempRoot = path.resolve(os.tmpdir());
const scratch = await mkdtemp(path.join(tempRoot, 'jungbu-extension-test-'));
assert.equal(path.dirname(scratch), tempRoot);
let context;
try {
  for (const [name, data] of Object.entries(files)) {
    const target = path.resolve(scratch, name);
    assert(target.startsWith(`${scratch}${path.sep}`));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  const extensionPath = path.join(scratch, 'lms-sync-extension');
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : undefined);
  context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    executablePath,
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  let expired = false;
  await context.route('https://ccanvas.joongbu.ac.kr/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Canvas test</title>' });
    } else if (url.pathname === '/api/v1/courses') {
      if (expired) await route.fulfill({ status: 401, json: { error: 'Unauthenticated' } });
      else await route.fulfill({ json: [{ id: 123, name: '모의 Canvas 과목' }] });
    } else if (url.pathname === '/api/v1/courses/123/assignments') {
      await route.fulfill({ json: [{ id: 456, name: '모의 Canvas 과제', due_at: '2035-11-12T23:59:00+09:00', lock_at: '2035-11-15T23:59:00+09:00', published: true, submission: { workflow_state: 'unsubmitted' } }] });
    } else {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });
  const dashboard = await context.newPage();
  await dashboard.goto(origin, { waitUntil: 'domcontentloaded' });
  const canvas = await context.newPage();
  await canvas.goto('https://ccanvas.joongbu.ac.kr/', { waitUntil: 'load' });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await canvas.bringToFront();
  const result = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'RUN_SYNC' }));
  assert.deepEqual(result, { ok: true, count: 1 });
  await dashboard.getByText('모의 Canvas 과제').first().waitFor({ timeout: 10000 });
  assert((await dashboard.locator('#assignmentRows').innerText()).includes('2035.11.12'));
  assert((await dashboard.locator('#assignmentRows').innerText()).includes('2035.11.15'));

  await dashboard.close();
  await canvas.bringToFront();
  const openedPage = context.waitForEvent('page', { timeout: 10000 });
  const secondResult = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'RUN_SYNC' }));
  assert.deepEqual(secondResult, { ok: true, count: 1 });
  const reopenedDashboard = await openedPage;
  await reopenedDashboard.waitForURL(`${origin}/#lms-sync`);
  await reopenedDashboard.getByText('모의 Canvas 과제').first().waitFor({ timeout: 10000 });
  assert.equal(canvas.url(), 'https://ccanvas.joongbu.ac.kr/');

  expired = true;
  await canvas.bringToFront();
  const expiredResult = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'RUN_SYNC' }));
  assert.equal(expiredResult.ok, false);
  assert(expiredResult.error.includes('OTP'));
  await reopenedDashboard.getByText('LMS 로그인이 만료됐어요.', { exact: false }).first().waitFor({ timeout: 10000 });
  console.log('Installed extension synced mock Canvas data, reopened the dashboard, and reported an expired session.');
} finally {
  if (context) await context.close();
  await rm(scratch, { recursive: true, force: true });
}
