function announce(payload) {
  const type = payload?.authExpired ? 'LMS_AUTH_EXPIRED' : 'LMS_SYNC_DATA';
  window.postMessage({ source: 'jungbu-lms-sync', type, payload }, window.location.origin);
}

chrome.storage.local.get('latestSync').then(({ latestSync }) => { if (latestSync) announce(latestSync); });
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'PUSH_SYNC') announce(message.payload); });
