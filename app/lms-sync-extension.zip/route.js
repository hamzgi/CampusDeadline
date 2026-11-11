import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const previousDashboard = 'https://jungbu-task-board.korpineapple0229.chatgpt.site/';
const extensionFiles = [
  'manifest.json', 'background.js', 'dashboard-bridge.js', 'lms-scraper.js',
  'popup.html', 'popup.css', 'popup.js',
];

function dashboardOrigin(request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || requestUrl.host;
  const protocol = request.headers.get('x-forwarded-proto') || requestUrl.protocol.slice(0, -1);
  const origin = new URL(`${protocol}://${host}`);
  if (origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('Invalid dashboard origin');
  }
  if (origin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('An HTTPS dashboard origin is required');
  }
  return origin;
}

export async function GET(request) {
  let origin;
  try {
    origin = dashboardOrigin(request);
  } catch {
    return new Response('Invalid dashboard origin', { status: 400 });
  }

  const contents = Object.fromEntries(await Promise.all(extensionFiles.map(async file => [
    file, await readFile(path.join(process.cwd(), 'extension', file), 'utf8'),
  ])));
  const dashboardUrl = `${origin.origin}/`;
  const dashboardMatch = `${origin.protocol}//${origin.hostname}/*`;
  const manifest = JSON.parse(contents['manifest.json']);
  manifest.version = '1.5.0';
  manifest.host_permissions = [...new Set([...manifest.host_permissions, dashboardMatch])];
  const bridge = manifest.content_scripts.find(item => item.js?.includes('dashboard-bridge.js'));
  if (!bridge) throw new Error('The dashboard bridge is missing from the extension manifest.');
  bridge.matches = [...new Set([...bridge.matches, dashboardMatch])];
  contents['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

  const oldUrlDeclaration = `const DASHBOARD_URL = '${previousDashboard}';`;
  const oldQuery = 'const tabs = await chrome.tabs.query({ url: [`${DASHBOARD_URL}*`] });';
  if (!contents['background.js'].includes(oldUrlDeclaration) || !contents['background.js'].includes(oldQuery)) {
    throw new Error('The extension background script no longer matches the expected template.');
  }
  contents['background.js'] = contents['background.js']
    .replace(oldUrlDeclaration, `const DASHBOARD_URL = ${JSON.stringify(dashboardUrl)};\nconst DASHBOARD_MATCHES = ${JSON.stringify([dashboardMatch, `${previousDashboard}*`])};`)
    .replace(oldQuery, 'const tabs = await chrome.tabs.query({ url: DASHBOARD_MATCHES });');

  // Next.js hydration can finish after the extension's first announcement.
  contents['dashboard-bridge.js'] += `\nwindow.addEventListener('message', event => {\n  if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'jungbu-task-board' || event.data?.type !== 'DASHBOARD_READY') return;\n  chrome.storage.local.get('latestSync').then(({ latestSync }) => { if (latestSync) announce(latestSync); });\n});\n`;

  const entries = Object.fromEntries(Object.entries(contents).map(([name, content]) => [
    `lms-sync-extension/${name}`, strToU8(content),
  ]));
  return new Response(zipSync(entries, { level: 6 }), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="lms-sync-extension.zip"',
      'Cache-Control': 'private, no-store',
    },
  });
}
