const DASHBOARD_URL = 'https://jungbu-task-board.korpineapple0229.chatgpt.site/';
const LMS_MATCH = /^https:\/\/(?:edu|ccanvas)\.joongbu\.ac\.kr\//;
const EDU_MATCH = /^https:\/\/edu\.joongbu\.ac\.kr\//;
const CANVAS_HOME_URL = 'https://ccanvas.joongbu.ac.kr/';

async function publishToDashboard(payload) {
  await chrome.storage.local.set({ latestSync: payload });
  const tabs = await chrome.tabs.query({ url: [`${DASHBOARD_URL}*`] });
  if (!tabs.length) {
    await chrome.tabs.create({ url: `${DASHBOARD_URL}#lms-sync` });
    return;
  }
  await Promise.all(tabs.map(async tab => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PUSH_SYNC', payload });
    } catch (error) {
      if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || '')) return;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dashboard-bridge.js'] });
    }
  }));
}

async function requestScrape(tabId) {
  const requestId = `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resultKey = `scrapeResult:${requestId}`;
  await chrome.storage.local.remove(resultKey);
  const result = waitForScrapeResult(resultKey);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lms-scraper.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'START_SCRAPE', requestId });
  return result;
}

function waitForScrapeResult(resultKey, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(listener);
      chrome.storage.local.remove(resultKey);
      resolve(value);
    };
    const listener = (changes, area) => {
      if (area === 'local' && changes[resultKey]?.newValue) finish(changes[resultKey].newValue);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.storage.onChanged.removeListener(listener);
      reject(new Error('과제 정보를 읽는 시간이 초과되었습니다. Canvas 로그인 상태를 확인해 주세요.'));
    }, timeoutMs);
    chrome.storage.onChanged.addListener(listener);
    chrome.storage.local.get(resultKey).then(stored => { if (stored[resultKey]) finish(stored[resultKey]); });
  });
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Canvas 페이지를 여는 시간이 초과되었습니다.')); }, timeoutMs);
    const listener = (updatedId, info, tab) => {
      if (updatedId === tabId && info.status === 'complete') { cleanup(); resolve(tab); }
    };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function canvasHelperTab() {
  const existing = await chrome.tabs.query({ url: ['https://ccanvas.joongbu.ac.kr/*'] });
  const available = existing.find(tab => tab.id && tab.status === 'complete');
  if (available) return { tab: available, temporary: false };
  const created = await chrome.tabs.create({ url: 'about:blank', active: false });
  const loaded = waitForTabComplete(created.id);
  await chrome.tabs.update(created.id, { url: CANVAS_HOME_URL });
  await loaded;
  const tab = await chrome.tabs.get(created.id);
  if (!/^https:\/\/ccanvas\.joongbu\.ac\.kr\//.test(tab.url || '')) throw new Error('Canvas 세션을 열지 못했습니다. LMS 로그인 상태를 확인해 주세요.');
  return { tab, temporary: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'RUN_SYNC') return;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !LMS_MATCH.test(tab.url || '')) {
      sendResponse({ ok: false, error: '중부대 LMS 또는 Canvas 과제 페이지를 연 뒤 다시 눌러 주세요.' });
      return;
    }
    try {
      const helper = EDU_MATCH.test(tab.url || '') ? await canvasHelperTab() : { tab, temporary: false };
      const result = await requestScrape(helper.tab.id);
      if (result?.authExpired) {
        await chrome.tabs.update(helper.tab.id, { active: true });
        await publishToDashboard({ authExpired: true, source: helper.tab.url, syncedAt: new Date().toISOString(), assignments: [] });
        sendResponse({ ok: false, error: 'LMS 로그인이 만료되었습니다. 직접 로그인/OTP 인증 후 다시 시도해 주세요.' });
        return;
      }
      const payload = { assignments: result?.assignments || [], source: helper.tab.url, syncedAt: new Date().toISOString() };
      await publishToDashboard(payload);
      if (helper.temporary) await chrome.tabs.remove(helper.tab.id);
      sendResponse({ ok: true, count: payload.assignments.length });
    } catch (error) {
      sendResponse({ ok: false, error: `동기화하지 못했습니다: ${error.message}` });
    }
  })();
  return true;
});
