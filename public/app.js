async function startBoard() {
const accountControl = document.querySelector('#accountControl');
let authState;
try {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('session unavailable');
  authState = await response.json();
  if (typeof authState.configured !== 'boolean' || (authState.user &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authState.user.id))) {
    throw new Error('invalid session');
  }
} catch {
  document.querySelector('.app-shell').hidden = true;
  const notice = document.createElement('div');
  notice.className = 'auth-unavailable';
  const message = document.createElement('p');
  message.textContent = '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', () => window.location.reload());
  notice.append(message, retry);
  document.body.append(notice);
  return;
}

const accountId = authState.user?.id || null;
const ACTIVE_ACCOUNT_KEY = 'jungbu-task-board-active-account';
const SYNC_INTENT_KEY = 'jungbu-task-board-sync-intent';
const accountScope = authState.configured ? (accountId || 'signed-out') : 'legacy';
try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountScope); } catch { /* Storage may be unavailable. */ }
window.addEventListener('storage', event => {
  if (event.key === ACTIVE_ACCOUNT_KEY && event.newValue !== accountScope) window.location.reload();
});

if (authState.configured && !accountId) {
  document.querySelector('.app-shell').hidden = true;
  const screen = document.createElement('main');
  screen.className = 'auth-screen';
  const card = document.createElement('section');
  card.className = 'auth-card';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'JUNGBU TASK BOARD';
  const title = document.createElement('h1');
  title.textContent = '과제 체크보드';
  const description = document.createElement('p');
  description.className = 'auth-description';
  description.textContent = 'Google 계정으로 로그인하고 내 과제를 확인하세요.';
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/auth/login';
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'auth-login-button';
  button.textContent = 'Google로 계속하기';
  form.append(button);
  const note = document.createElement('p');
  note.className = 'auth-note';
  note.textContent = '지금은 과제가 이 기기에 저장됩니다. 휴대폰 동기화는 준비 중입니다.';
  card.append(eyebrow, title, description, form, note);
  if (new URL(window.location.href).searchParams.has('auth_error')) {
    const error = document.createElement('p');
    error.className = 'auth-error';
    error.setAttribute('role', 'alert');
    error.textContent = '로그인하지 못했어요. 다시 시도해 주세요.';
    card.append(error);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('auth_error');
    history.replaceState(null, '', cleanUrl);
  }
  screen.append(card);
  document.body.append(screen);
  return;
}

if (authState.configured && accountControl) {
  accountControl.hidden = false;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/auth/logout';
  const label = document.createElement('span');
  label.className = 'account-email';
  label.textContent = authState.user.email || '로그인됨';
  label.title = label.textContent;
  accountControl.append(label);
  form.addEventListener('submit', () => localStorage.removeItem(SYNC_INTENT_KEY));
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'account-button';
  button.textContent = '로그아웃';
  form.append(button);
  accountControl.append(form);
}

const STORAGE_KEY = accountId ? `jungbu-task-board-account-${accountId}-v1` : 'jungbu-task-board-v2';
const META_KEY = accountId ? `jungbu-task-board-lms-meta-${accountId}` : 'jungbu-task-board-lms-meta';
const LEGACY_DEMO_IDS = new Set(['a1','a2','a3','a4','a5','a6','a7']);
const now = new Date();

let assignments = loadAssignments();
let statusFilter = 'all';
let courseFilter = 'all';
let timelineWindow = 'week';
let importItems = [];
const colors = ['#5e71e8','#ef8b71','#57b49a','#a47ee6','#d79a37','#4f9bcf','#d96e9a'];

function loadAssignments() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || (!accountId && localStorage.getItem('jungbu-task-board-v1')));
    return Array.isArray(saved) ? saved.filter(item => !LEGACY_DEMO_IDS.has(item.id) && !(item.source === 'lms' && !hasValidLmsDate(item.due))) : [];
  } catch { return []; }
}
function saveAssignments() { localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments)); }
function getCourseColor(course) { const courses = [...new Set(assignments.map(a => a.course))].sort(); return colors[Math.max(0,courses.indexOf(course)) % colors.length]; }
function dateOf(value) { return value ? new Date(value) : null; }
function hasValidLmsDate(value) { const date = dateOf(value); return isValid(date) && date.getFullYear() >= 2000; }
function isValid(d) { return d && !Number.isNaN(d.valueOf()); }
function hoursUntil(value) { return (dateOf(value) - now) / 36e5; }
function getEffectiveStatus(a) {
  if (a.status === 'submitted') return 'submitted';
  const due = hoursUntil(a.due), recognition = a.recognition ? hoursUntil(a.recognition) : -1;
  if (due < 0 && recognition > 0) return 'late';
  if (due < 0 && recognition <= 0) return 'expired';
  if (due <= 72) return 'urgent';
  return 'open';
}
function shortDate(value) { const d=dateOf(value); return isValid(d) ? `${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '미정'; }
function formatDate(value) { const d=dateOf(value); return isValid(d) ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}<br><span class="muted">${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>` : '<span class="muted">없음</span>'; }
function deadlineText(a) { const h = hoursUntil(a.due); if (h < 0) return '마감 지남'; if (h < 1) return '1시간 이내'; if (h < 24) return `${Math.ceil(h)}시간 남음`; if (h < 48) return '내일 마감'; return `D-${Math.ceil(h/24)}`; }
function statusLabel(status) { return {open:'미제출',urgent:'마감 임박',submitted:'제출 완료',late:'인정 기한 중',expired:'기한 종료'}[status]; }
function cmp(a,b) { return dateOf(a.due)-dateOf(b.due); }

function render() { renderDate(); renderSidebar(); renderStats(); renderAttention(); renderTimeline(); renderWeek(); renderTable(); }
function renderDate() { const days=['일요일','월요일','화요일','수요일','목요일','금요일','토요일']; document.querySelector('#todayLabel').textContent=`${now.getFullYear()}. ${now.getMonth()+1}. ${now.getDate()}. ${days[now.getDay()]}`; }
function renderSidebar() {
  const courses=[...new Set(assignments.map(a=>a.course))].sort(); document.querySelector('#courseCount').textContent=courses.length; document.querySelector('#navTaskCount').textContent=assignments.filter(a=>a.status!=='submitted').length;
  document.querySelector('#courseNavList').innerHTML = courses.map(c=>`<button class="course-nav-item ${courseFilter===c?'selected':''}" data-course="${escapeAttr(c)}"><i class="course-color" style="background:${getCourseColor(c)}"></i><span>${escapeHtml(c)}</span></button>`).join('');
  document.querySelector('#courseOptions').innerHTML=courses.map(c=>`<option value="${escapeAttr(c)}"></option>`).join('');
}
function renderStats() {
  const alive=assignments.filter(a=>getEffectiveStatus(a)!=='expired'); const open=alive.filter(a=>a.status!=='submitted'); const urgent=open.filter(a=>getEffectiveStatus(a)==='urgent'); const done=assignments.filter(a=>a.status==='submitted'); const rate=assignments.length ? Math.round(done.length/assignments.length*100) : 0;
  document.querySelector('#openCount').textContent=open.length; document.querySelector('#urgentCount').textContent=urgent.length; document.querySelector('#doneCount').textContent=done.length; document.querySelector('#progressText').textContent=`${rate}%`; document.querySelector('#progressBar').style.width=`${rate}%`; document.querySelector('#progressCaption').textContent=assignments.length ? `${done.length}/${assignments.length}개 과제를 제출했어요` : 'LMS 동기화 후 자동으로 표시돼요'; document.querySelector('#allFilterCount').textContent=assignments.length;
}
function renderAttention() {
  const next=assignments.filter(a=>a.status!=='submitted'&&hoursUntil(a.due)>=0).sort(cmp)[0]; const title=document.querySelector('#attentionTitle'), desc=document.querySelector('#attentionDescription');
  if(next){ title.textContent=`${deadlineText(next)} · ${next.title}`; desc.textContent=`${next.course} · 마감 ${shortDate(next.due)}`; } else if(!assignments.length) { title.textContent='실제 LMS 과제를 동기화해 주세요.'; desc.textContent='동기화 버튼을 누르면, 로그인된 LMS 세션에서 과제를 읽어올 수 있어요.'; } else { title.textContent='남은 마감 과제가 없어요.'; desc.textContent='제출한 과제와 인정 기한은 아래 보드에서 확인할 수 있어요.'; }
}
function renderTimeline() {
  const filtered=assignments.filter(a=>a.status!=='submitted' && getEffectiveStatus(a)!=='expired' && (timelineWindow==='all'||hoursUntil(a.due)<=168)).sort(cmp).slice(0,4); const root=document.querySelector('#timeline');
  root.innerHTML=filtered.length ? filtered.map(a=>{const d=dateOf(a.due), status=getEffectiveStatus(a); return `<article class="timeline-item"><div class="date-block"><b>${String(d.getDate()).padStart(2,'0')}</b><span>${d.getMonth()+1}월</span></div><div><div class="timeline-course"><i class="course-pill" style="background:${getCourseColor(a.course)}"></i>${escapeHtml(a.course)}</div><div class="timeline-title">${escapeHtml(a.title)}</div></div><span class="deadline-badge ${status==='urgent'?'urgent':''}">${deadlineText(a)}</span></article>`;}).join('') : '<div class="empty-state"><div>✓</div><strong>다가오는 마감이 없어요</strong><p>숨 돌리고 다음 일정을 준비해요.</p></div>';
}
function renderWeek() {
  const days=['일','월','화','수','목','금','토']; const start=new Date(now); start.setDate(now.getDate()-now.getDay()); start.setHours(0,0,0,0); let within=0; let html='';
  for(let i=0;i<7;i++){const day=new Date(start); day.setDate(start.getDate()+i); const count=assignments.filter(a=>{const d=dateOf(a.due);return a.status!=='submitted'&&d&&d.getFullYear()===day.getFullYear()&&d.getMonth()===day.getMonth()&&d.getDate()===day.getDate();}).length; within+=count; const today=day.toDateString()===now.toDateString(); html+=`<div class="week-day ${today?'today':''} ${count?'has-task':''}"><span>${days[i]}</span><b>${day.getDate()}</b><div class="day-dots">${Array(Math.min(3,count)).fill('<i></i>').join('')}</div></div>`;}
  document.querySelector('#weekDays').innerHTML=html; document.querySelector('#weekTotal').textContent=`${within}건`; document.querySelector('#weekNote').textContent=within ? `이번 주 ${within}건의 마감이 있어요. 노란 날짜를 먼저 챙겨 보세요.` : '이번 주는 미제출 과제의 마감이 없어요. 다음 주 일정을 미리 확인해 볼까요?';
}
function matchesFilter(a) { const state=getEffectiveStatus(a); if(courseFilter!=='all'&&a.course!==courseFilter)return false; if(statusFilter==='all')return true; if(statusFilter==='open')return a.status!=='submitted'&&state!=='expired'; return state===statusFilter; }
function renderTable() {
  const shown=assignments.filter(matchesFilter).sort((a,b)=>a.status==='submitted'&&b.status!=='submitted'?1:b.status==='submitted'&&a.status!=='submitted'?-1:cmp(a,b)); const tbody=document.querySelector('#assignmentRows');
  tbody.innerHTML=shown.map(a=>{const st=getEffectiveStatus(a), recognition=a.recognition?formatDate(a.recognition):'<span class="muted">없음</span>';return `<tr><td><div class="assignment-name">${escapeHtml(a.title)}</div><div class="assignment-sub">${a.status==='submitted'?'제출 확인됨':'LMS에서 상태 확인 필요'}</div></td><td class="course-cell"><i class="course-pill" style="background:${getCourseColor(a.course)}"></i>${escapeHtml(a.course)}</td><td class="date-cell ${hoursUntil(a.due)<0&&a.status!=='submitted'?'overdue':''}">${formatDate(a.due)}</td><td class="date-cell">${recognition}</td><td><span class="status-badge status-${st}">${statusLabel(st)}</span></td><td><div class="row-actions">${a.url?`<a class="row-action" href="${safeUrl(a.url)}" target="_blank" rel="noopener" title="LMS 열기">↗</a>`:''}<button class="row-action" data-toggle="${a.id}" title="제출 상태 전환">${a.status==='submitted'?'↶':'✓'}</button><button class="row-action" data-delete="${a.id}" title="삭제">×</button></div></td></tr>`;}).join('');
  document.querySelector('#emptyState').hidden=shown.length>0; document.querySelector('.assignment-table-wrap').hidden=shown.length===0; document.querySelector('#courseFilterText').textContent=courseFilter==='all'?'전체 과목':courseFilter;
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));} function escapeAttr(v){return escapeHtml(v);} function safeUrl(v){try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
function openModal(id){document.querySelector(id).classList.add('open');document.querySelector(id).setAttribute('aria-hidden','false');} function closeModal(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}
function parseDate(input){const cleaned=input.trim().replace(/\./g,'-').replace(/년|월/g,'-').replace(/일/g,'').replace(/\s+/g,' ');let d=new Date(cleaned.replace(' ','T'));if(isValid(d)) return d; const m=cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);return m?new Date(+m[1],+m[2]-1,+m[3],+(m[4]||23),+(m[5]||59)):null;}

document.querySelector('#openAdd').addEventListener('click',()=>openModal('#assignmentModal'));document.querySelector('#openImport').addEventListener('click',()=>openModal('#importModal'));document.querySelector('#openSync').addEventListener('click',()=>{if(accountId){const startedAt=Date.now();localStorage.setItem(SYNC_INTENT_KEY,JSON.stringify({accountId,startedAt,expiresAt:startedAt+10*60*1000}));}openModal('#syncModal');});document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.closest('.modal'))));document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m);}));
document.querySelector('#assignmentForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),newItem={id:'a'+Date.now(),title:f.get('title').trim(),course:f.get('course').trim(),due:f.get('due'),recognition:f.get('recognition'),url:f.get('url').trim(),status:f.get('submitted')?'submitted':'open'};assignments.push(newItem);saveAssignments();render();closeModal(document.querySelector('#assignmentModal'));e.target.reset();toast('과제가 보드에 추가됐어요.');});
document.querySelector('#statusFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;statusFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTable();});
document.querySelector('#courseNavList').addEventListener('click',e=>{const b=e.target.closest('[data-course]');if(!b)return;courseFilter=courseFilter===b.dataset.course?'all':b.dataset.course;renderSidebar();renderTable();});
document.querySelector('#courseFilter').addEventListener('click',()=>{courseFilter='all';renderSidebar();renderTable();toast('전체 과목을 표시해요.');});
document.querySelector('#assignmentRows').addEventListener('click',e=>{const toggle=e.target.closest('[data-toggle]'),del=e.target.closest('[data-delete]');if(toggle){const a=assignments.find(x=>x.id===toggle.dataset.toggle);a.status=a.status==='submitted'?'open':'submitted';saveAssignments();render();toast(a.status==='submitted'?'제출 완료로 표시했어요.':'미제출로 되돌렸어요.');}if(del){assignments=assignments.filter(x=>x.id!==del.dataset.delete);saveAssignments();render();toast('과제를 삭제했어요.');}});
document.querySelectorAll('.view-tabs button').forEach(b=>b.addEventListener('click',()=>{timelineWindow=b.dataset.window;document.querySelectorAll('.view-tabs button').forEach(x=>x.classList.toggle('selected',x===b));renderTimeline();}));
document.querySelector('#showAllAssignments').addEventListener('click',()=>{document.querySelector('#assignment-list').scrollIntoView({behavior:'smooth'});});document.querySelector('#attentionLink').addEventListener('click',()=>{});
document.querySelector('#themeToggle').addEventListener('click',()=>{document.body.classList.toggle('dark');toast(document.body.classList.contains('dark')?'다크 모드로 바꿨어요.':'라이트 모드로 바꿨어요.');});
document.querySelector('#importButton').addEventListener('click',()=>{const lines=document.querySelector('#importText').value.split('\n').map(x=>x.trim()).filter(Boolean);importItems=lines.map(line=>{const p=line.split('|').map(x=>x.trim());const due=parseDate(p[2]||'');return p.length>=3&&due?{course:p[0],title:p[1],due:toInput(due),recognition:toInput(parseDate(p[3]||''))}:null;}).filter(Boolean);const box=document.querySelector('#importPreview');if(!importItems.length){box.innerHTML='<div class="import-help">날짜를 읽지 못했어요. 예시처럼 <code>|</code>로 항목을 나눠 주세요.</div>';return;}box.innerHTML=`<p class="eyebrow">${importItems.length}개 항목을 찾았어요</p>${importItems.map((item,i)=>`<div class="preview-row"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.course)} · ${shortDate(item.due)}</span></div><button data-import-one="${i}">추가</button></div>`).join('')}<button class="submit-button" id="importAll">모두 추가하기 <span>→</span></button>`;});
document.querySelector('#importPreview').addEventListener('click',e=>{const one=e.target.closest('[data-import-one]');if(one){addImported([importItems[Number(one.dataset.importOne)]]);e.target.closest('.preview-row').remove();}if(e.target.closest('#importAll'))addImported(importItems);});
function addImported(items){const valid=items.filter(Boolean);if(!valid.length)return;assignments.push(...valid.map(i=>({...i,id:'a'+Date.now()+Math.random(),url:'',status:'open'})));saveAssignments();render();closeModal(document.querySelector('#importModal'));document.querySelector('#importText').value='';document.querySelector('#importPreview').innerHTML='';toast(`${valid.length}개 과제를 가져왔어요.`);}
function toInput(d){return isValid(d)?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:'';}
document.querySelector('#exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(assignments,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='과제체크보드-2026-2학기.json';a.click();URL.revokeObjectURL(url);toast('내 과제 데이터를 내보냈어요.');});
function stableId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `lms-${(hash >>> 0).toString(36)}`;
}
function applyLmsSync(payload) {
  if (!payload || !Array.isArray(payload.assignments)) return;
  const synced = payload.assignments.filter(item => item && item.title && item.course && hasValidLmsDate(item.due)).map(item => ({
    id: stableId(`${item.url || ''}|${item.course}|${item.title}|${item.due}`), title: String(item.title).trim(), course: String(item.course).trim(),
    due: String(item.due), recognition: item.recognition ? String(item.recognition) : '', url: safeUrl(item.url || 'https://edu.joongbu.ac.kr/mypage'),
    status: item.status === 'submitted' ? 'submitted' : 'open', source: 'lms'
  }));
  assignments = [...assignments.filter(item => item.source !== 'lms'), ...synced];
  saveAssignments();
  localStorage.setItem(META_KEY, JSON.stringify({ syncedAt: payload.syncedAt || new Date().toISOString(), source: payload.source || 'LMS' }));
  render();
  closeModal(document.querySelector('#syncModal'));
  toast(synced.length ? `LMS 실제 과제 ${synced.length}개를 동기화했어요.` : '과제 항목을 찾지 못했어요. LMS 과제 화면에서 다시 동기화해 주세요.');
}
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'jungbu-lms-sync') return;
  if (event.data.type === 'LMS_SYNC_DATA') {
    if (accountId) {
      let intent;
      try { intent = JSON.parse(localStorage.getItem(SYNC_INTENT_KEY)); } catch { return; }
      const syncedAt = Date.parse(event.data.payload?.syncedAt || '');
      if (!intent || intent.accountId !== accountId || !Number.isFinite(intent.startedAt) ||
          !Number.isFinite(intent.expiresAt) || !Number.isFinite(syncedAt) ||
          syncedAt < intent.startedAt || Date.now() > intent.expiresAt) return;
      localStorage.removeItem(SYNC_INTENT_KEY);
    }
    applyLmsSync(event.data.payload);
  }
  if (event.data.type === 'LMS_AUTH_EXPIRED') toast('LMS 로그인이 만료됐어요. LMS에서 직접 OTP 인증 후 다시 동기화해 주세요.');
});
render();
window.postMessage({ source: 'jungbu-task-board', type: 'DASHBOARD_READY' }, window.location.origin);
if (new URL(window.location.href).searchParams.has('auth_error')) {
  toast('로그인하지 못했어요. 다시 시도해 주세요.');
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('auth_error');
  history.replaceState(null, '', cleanUrl);
}
}

startBoard();
