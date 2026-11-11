(() => {
  if (globalThis.__jungbuLmsSyncScraperV14) return;
  globalThis.__jungbuLmsSyncScraperV14 = true;
  const LMS_ORIGINS = new Set(['https://edu.joongbu.ac.kr', 'https://ccanvas.joongbu.ac.kr']);
  const MAX_PAGES = 35;
  const PAGE_DELAY_MS = 180;
  const LINK_HINT = /assignment|assign|task|todo|homework|course|subject|lecture|class|lesson|과제|강의|수업/i;
  const DATE_PATTERN = /(20\d{2})\s*(?:[.\-/년]\s*)(\d{1,2})\s*(?:[.\-/월]\s*)(\d{1,2})(?:\s*일)?(?:\s*\([^)]*\))?(?:\s*(오전|오후|am|pm)?\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*(?:분)?)?/gi;
  const YEARLESS_KOREAN_DATE_PATTERN = /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?(?:\s*(오전|오후|am|pm)?\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*(?:분)?)?/gi;

  const compact = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const unique = values => [...new Set(values)];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function toDateString(match) {
    let [, year, month, day, meridiem = '', hour = '23', minute = '59'] = match;
    let hourNumber = Number(hour);
    if (/오후|pm/i.test(meridiem) && hourNumber < 12) hourNumber += 12;
    if (/오전|am/i.test(meridiem) && hourNumber === 12) hourNumber = 0;
    const date = new Date(Number(year), Number(month) - 1, Number(day), hourNumber, Number(minute));
    if (Number.isNaN(date.valueOf())) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hourNumber).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function datesIn(text) {
    const withYear = [...compact(text).matchAll(DATE_PATTERN)].map(toDateString).filter(Boolean);
    if (withYear.length) return withYear;
    return [...compact(text).matchAll(YEARLESS_KOREAN_DATE_PATTERN)].map(toYearlessDateString).filter(Boolean);
  }

  function toYearlessDateString(match) {
    let [, month, day, meridiem = '', hour = '23', minute = '59'] = match;
    let hourNumber = Number(hour);
    if (/오후|pm/i.test(meridiem) && hourNumber < 12) hourNumber += 12;
    if (/오전|am/i.test(meridiem) && hourNumber === 12) hourNumber = 0;
    const current = new Date();
    let year = current.getFullYear();
    let candidate = new Date(year, Number(month) - 1, Number(day), hourNumber, Number(minute));
    if (candidate.valueOf() < current.valueOf() - 45 * 24 * 60 * 60 * 1000) {
      year += 1;
      candidate = new Date(year, Number(month) - 1, Number(day), hourNumber, Number(minute));
    }
    if (Number.isNaN(candidate.valueOf())) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hourNumber).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function dateAfterLabel(text, label) {
    const position = text.search(label);
    if (position < 0) return '';
    return datesIn(text.slice(position, position + 110))[0] || '';
  }

  function isLoginDocument(documentToCheck, url = '') {
    const text = compact(documentToCheck.body?.innerText || documentToCheck.documentElement?.textContent || '');
    return /\/sso\/|business\.php/i.test(url) || (/로그인|통합인증/.test(text) && /OTP|인증번호|비밀번호/.test(text));
  }

  function safeUrl(href, base) {
    try {
      const parsed = new URL(href, base);
      if (!LMS_ORIGINS.has(parsed.origin) || !/^https:$/.test(parsed.protocol) || /logout|signout|delete|withdraw/i.test(parsed.href)) return '';
      parsed.hash = '';
      return parsed.href;
    } catch { return ''; }
  }

  function courseName(documentToCheck) {
    const canvasBreadcrumb = [...documentToCheck.querySelectorAll('#breadcrumbs a[href*="/courses/"], .ic-app-nav-toggle-and-crumbs a[href*="/courses/"], a[href^="/courses/"]')]
      .map(node => compact(node.textContent))
      .find(value => value && value.length < 100 && !/assignment|과제|home|grades|성적/i.test(value));
    if (canvasBreadcrumb) return canvasBreadcrumb;
    const preferred = documentToCheck.querySelector('[class*="course-title" i], [class*="subject-name" i], [class*="lecture-title" i], .course_name, .subject_name, .lecture_name');
    const heading = preferred || documentToCheck.querySelector('h1, h2');
    const fromHeading = compact(heading?.textContent);
    if (fromHeading && fromHeading.length < 100) return fromHeading;
    return compact(documentToCheck.title).split('|')[0].split('-')[0].trim() || '중부대학교 LMS';
  }

  function titleFrom(element, text) {
    const selector = '[class*="title" i], [class*="name" i], [class*="subject" i] a, a';
    const preferred = [...element.querySelectorAll(selector)].map(node => compact(node.textContent)).find(value => value.length > 2 && value.length < 130 && !/과제|마감|제출|인정|상세보기|바로가기/.test(value));
    if (preferred) return preferred;
    const line = String(element.innerText || '').split(/[\n\r]+/).map(compact).find(value => value.length > 2 && value.length < 130 && !/20\d{2}|마감|제출기한|인정기한/.test(value));
    if (line) return line;
    return compact(text).replace(/20\d{2}[^\n]{0,45}/g, '').slice(0, 120);
  }

  function itemUrl(element, base) {
    const anchor = element.matches('a[href]') ? element : element.querySelector('a[href*="assign" i], a[href*="task" i], a[href*="todo" i], a[href]');
    return safeUrl(anchor?.href || '', base);
  }

  function extractAssignments(documentToCheck, baseUrl) {
    const pageCourse = courseName(documentToCheck);
    const selectors = [
      'tr', 'li', 'article',
      '[class*="assignment" i]', '[class*="task" i]', '[class*="todo" i]', '[class*="homework" i]',
      '[data-type*="assignment" i]', '[data-content*="assignment" i]'
    ].join(',');
    const candidates = [...documentToCheck.querySelectorAll(selectors)].filter(element => {
      const text = compact(element.innerText || element.textContent);
      return text.length >= 8 && text.length <= 900 && datesIn(text).length > 0;
    });
    const extracted = [];
    for (const element of candidates) {
      const text = compact(element.innerText || element.textContent);
      const due = dateAfterLabel(text, /제출\s*(기한|마감|기간|일시)?|마감\s*(기한|일시)?|종료\s*(일시|기한)?/i) || datesIn(text)[0];
      const recognition = dateAfterLabel(text, /인정\s*(기한|기간|마감)?|지각\s*(기한|제출)?|연장\s*(기한|기간)?|추가\s*(기한|제출)?/i);
      const title = titleFrom(element, text);
      if (!due || !title || /^(제출|마감|인정|과제)$/i.test(title)) continue;
      const courseInCard = [...element.querySelectorAll('[class*="course" i], [class*="subject" i], [class*="lecture" i]')].map(node => compact(node.textContent)).find(value => value && value.length < 100);
      extracted.push({
        title,
        course: courseInCard || pageCourse,
        due,
        recognition,
        url: itemUrl(element, baseUrl) || baseUrl,
        status: /제출\s*(완료|됨)|완료\s*제출|제출완료/i.test(text) ? 'submitted' : 'open'
      });
    }
    return extracted;
  }

  function childLinks(documentToCheck, baseUrl) {
    return unique([...documentToCheck.querySelectorAll('a[href]')]
      .map(anchor => ({ href: safeUrl(anchor.getAttribute('href'), baseUrl), text: compact(anchor.textContent) }))
      .filter(link => link.href && LINK_HINT.test(`${link.href} ${link.text}`))
      .map(link => link.href));
  }

  function canvasDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return '';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf()) || date.getFullYear() < 2000) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  async function canvasJson(path) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) return { authExpired: true, data: [] };
    if (!response.ok) throw new Error(`Canvas API ${response.status}`);
    return { authExpired: false, data: await response.json() };
  }

  async function scrapeCanvasApi() {
    const coursesResponse = await canvasJson('/api/v1/courses?enrollment_state=active&per_page=100');
    if (coursesResponse.authExpired) return { assignments: [], authExpired: true };
    const courses = Array.isArray(coursesResponse.data) ? coursesResponse.data.filter(course => course?.id && course?.name) : [];
    const assignments = [];
    for (const course of courses) {
      const response = await canvasJson(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission&include[]=all_dates`);
      if (response.authExpired) return { assignments: [], authExpired: true };
      for (const assignment of Array.isArray(response.data) ? response.data : []) {
        const due = canvasDate(assignment.due_at || assignment.all_dates?.[0]?.due_at);
        if (!assignment?.name || !due || assignment.published === false) continue;
        const submission = assignment.submission || {};
        const submitted = Boolean(submission.submitted_at) || ['submitted', 'graded', 'pending_review', 'complete'].includes(submission.workflow_state);
        assignments.push({
          title: compact(assignment.name), course: compact(course.name), due,
          recognition: canvasDate(assignment.lock_at || assignment.all_dates?.[0]?.lock_at),
          url: `${location.origin}/courses/${course.id}/assignments/${assignment.id}`,
          status: submitted ? 'submitted' : 'open'
        });
      }
      await pause(PAGE_DELAY_MS);
    }
    return { assignments, authExpired: false };
  }

  async function getDocument(url) {
    if (url === location.href.split('#')[0]) return { documentToCheck: document, finalUrl: location.href };
    const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
    const html = await response.text();
    return { documentToCheck: new DOMParser().parseFromString(html, 'text/html'), finalUrl: response.url || url };
  }

  async function scrape() {
    if (location.hostname === 'ccanvas.joongbu.ac.kr') {
      try {
        const apiResult = await scrapeCanvasApi();
        if (apiResult.authExpired || apiResult.assignments.length) return apiResult;
      } catch { /* Fall back to visible Canvas assignment cards below. */ }
    }
    const queue = [{ url: location.href.split('#')[0], depth: 0 }];
    const visited = new Set();
    const assignments = [];
    let authExpired = isLoginDocument(document, location.href);
    while (queue.length && visited.size < MAX_PAGES && !authExpired) {
      const next = queue.shift();
      if (!next || visited.has(next.url)) continue;
      visited.add(next.url);
      let loaded;
      try { loaded = await getDocument(next.url); } catch { continue; }
      if (isLoginDocument(loaded.documentToCheck, loaded.finalUrl)) { authExpired = true; break; }
      assignments.push(...extractAssignments(loaded.documentToCheck, loaded.finalUrl));
      if (next.depth < 2) {
        for (const link of childLinks(loaded.documentToCheck, loaded.finalUrl)) {
          if (!visited.has(link) && queue.length + visited.size < MAX_PAGES) queue.push({ url: link, depth: next.depth + 1 });
        }
      }
      await pause(PAGE_DELAY_MS);
    }
    const seen = new Set();
    const deduped = assignments.filter(item => {
      const key = `${item.course}|${item.title}|${item.due}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { assignments: deduped, authExpired };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'START_SCRAPE' || !message.requestId) return;
    const resultKey = `scrapeResult:${message.requestId}`;
    scrape()
      .then(result => chrome.storage.local.set({ [resultKey]: result }))
      .catch(error => chrome.storage.local.set({ [resultKey]: { assignments: [], error: error.message } }));
    sendResponse({ started: true });
  });
})();
