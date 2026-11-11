const button = document.querySelector('#syncButton');
const status = document.querySelector('#status');
button.addEventListener('click', () => {
  button.disabled = true;
  status.className = '';
  status.textContent = 'LMS 페이지를 확인하고 과제를 읽는 중…';
  chrome.runtime.sendMessage({ type: 'RUN_SYNC' }, response => {
    button.disabled = false;
    if (chrome.runtime.lastError) {
      status.className = 'error';
      status.textContent = '브라우저와 통신하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
      return;
    }
    if (!response?.ok) {
      status.className = 'error';
      status.textContent = response?.error || '동기화하지 못했습니다.';
      return;
    }
    status.className = 'success';
    status.textContent = `${response.count}개 실제 과제를 체크보드로 보냈어요.`;
  });
});
