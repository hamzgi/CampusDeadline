import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { strFromU8, unzipSync } from 'fflate';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3147';
const origin = new URL(baseUrl);
const response = await fetch(`${origin.origin}/lms-sync-extension.zip`);
assert.equal(response.status, 200, 'extension download should succeed');
const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
const get = name => strFromU8(files[`lms-sync-extension/${name}`]);
const manifest = JSON.parse(get('manifest.json'));
const match = `${origin.protocol}//${origin.hostname}/*`;
assert.equal(manifest.version, '1.5.0');
assert(manifest.host_permissions.includes(match));
assert(manifest.host_permissions.includes('https://jungbu-task-board.korpineapple0229.chatgpt.site/*'));
assert(manifest.content_scripts.find(item => item.js?.includes('dashboard-bridge.js')).matches.includes(match));
assert(get('background.js').includes(`const DASHBOARD_URL = "${origin.origin}/";`));
assert(get('background.js').includes('https://jungbu-task-board.korpineapple0229.chatgpt.site/*'));

const sources = {
  '/': ['source/index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
};
const originalServer = createServer(async (request, reply) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/auth/session') {
    reply.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ configured: false, user: null }));
    return;
  }
  const entry = sources[pathname];
  if (!entry) { reply.writeHead(404).end(); return; }
  reply.writeHead(200, { 'Content-Type': entry[1] }).end(await readFile(entry[0]));
});
await new Promise(resolve => originalServer.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : undefined);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const original = await context.newPage();
  const migrated = await context.newPage();
  const errors = [];
  migrated.on('pageerror', error => errors.push(error.message));
  await original.goto(`http://127.0.0.1:${originalServer.address().port}/`, { waitUntil: 'domcontentloaded' });
  await migrated.goto(origin.origin, { waitUntil: 'domcontentloaded' });
  await migrated.waitForFunction(() => document.querySelector('#attentionTitle')?.textContent.includes('동기화'));
  await original.waitForFunction(() => document.querySelector('#attentionTitle')?.textContent.includes('동기화'));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await original.setViewportSize(viewport);
    await migrated.setViewportSize(viewport);
    for (const selector of ['.sidebar', '.stats', '.deadline-panel', '.week-panel', '.assignments-section']) {
      const oldBox = await original.locator(selector).boundingBox();
      const newBox = await migrated.locator(selector).boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) {
        assert(Math.abs(oldBox[key] - newBox[key]) < 2, `${viewport.width}px ${selector} ${key} changed`);
      }
    }
  }

  const syncContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const payload = {
    assignments: [{ title: '동기화 테스트 과제', course: '테스트 과목', due: '2035-11-12T23:59:00+09:00', recognition: '', url: 'https://ccanvas.joongbu.ac.kr/courses/1/assignments/2', status: 'open' }],
    syncedAt: '2026-11-11T00:00:00.000Z',
  };
  await syncContext.addInitScript(({ bridgeSource, latestSync }) => {
    if (!['http:', 'https:'].includes(window.location.protocol)) return;
    window.chrome = {
      storage: { local: { get: async () => ({ latestSync }) } },
      runtime: { onMessage: { addListener: () => {} } },
    };
    (0, eval)(bridgeSource);
  }, { bridgeSource: get('dashboard-bridge.js'), latestSync: payload });
  const page = await syncContext.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('동기화 테스트 과제').first().waitFor();
  assert.equal(await page.locator('#assignmentRows tr').count(), 1);
  assert((await page.locator('#assignmentRows').innerText()).includes('2035.11.12'));

  await page.locator('#openAdd').click();
  await page.locator('input[name="title"]').fill('직접 추가 과제');
  await page.locator('input[name="course"]').fill('테스트 과목');
  await page.locator('input[name="due"]').fill('2035-11-13T23:59');
  await page.locator('#assignmentForm button[type="submit"]').click();
  assert.equal(await page.locator('#assignmentRows tr').count(), 2);
  await page.locator('#themeToggle').click();
  assert(await page.locator('body').evaluate(element => element.classList.contains('dark')));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('직접 추가 과제').first().waitFor();
  assert.equal(await page.locator('#assignmentRows tr').count(), 2);
  assert.deepEqual(errors, []);
  console.log('Dashboard layout, interactions, persistence, extension ZIP and early sync handoff passed.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => originalServer.close(resolve));
}
