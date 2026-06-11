/**
 * study.js — 단어공부 모듈
 * GitHubModule에 의존
 */
const StudyModule = (() => {

  /* ── 상태 ── */
  let allWords = [];
  let currentFile = null;
  let localCounts = {};
  let selectedStudyCount = null; // null = 전체
  let colVis = { lao: true, eng: true, kor: true, pron: true };
  let currentAudio = null;
  let notebookFiles = [];

  const LOCAL_KEY = 'study_counts';
  const MAX_STUDY = 7;

  /* ── 로컬 카운트 ── */
  function loadLocalCounts() {
    try { localCounts = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch(e) {}
  }
  function saveLocalCounts() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(localCounts));
  }

  /* ── 노트북 목록 로드 ── */
  async function loadNotebooks() {
    const cfg = GitHubModule.get();
    const sel = document.getElementById('study-notebook-sel');
    sel.innerHTML = '<option>로딩 중…</option>';

    try {
      const tree = await GitHubModule.fetchTree();
      notebookFiles = tree.tree
        .filter(f => f.type === 'blob' && f.path.endsWith('.md'))
        // .Trash, .obsidian 등 숨김 폴더 제외
        .filter(f => !f.path.split('/').some(p => p.startsWith('.')))
        // 성경 폴더 제외
        .filter(f => !cfg.bibleFolder || !f.path.startsWith(cfg.bibleFolder + '/'));

      // wordsFolder 설정 시 그 폴더만 (대소문자 무시, 앞뒤 슬래시 정규화)
      if (cfg.wordsFolder) {
        const folder = cfg.wordsFolder.replace(/^\/+|\/+$/g, '').toLowerCase();
        notebookFiles = notebookFiles.filter(f =>
          f.path.toLowerCase().startsWith(folder + '/')
        );
      }

      if (!notebookFiles.length) {
        sel.innerHTML = '<option value="">— .md 파일 없음 —</option>';
        showStatus('📭', '.md 파일 없음', '단어장 폴더 경로를 확인하세요');
        return;
      }

      sel.innerHTML = notebookFiles.map(f =>
        `<option value="${f.path}">${f.path.split('/').pop().replace(/\.md$/, '')}</option>`
      ).join('');

      const last = localStorage.getItem('study_last_file');
      if (last && notebookFiles.find(f => f.path === last)) sel.value = last;

      await loadCurrentNotebook();
    } catch(e) {
      sel.innerHTML = '<option value="">— 오류 —</option>';
      showStatus('❌', '저장소 접근 실패', e.message);
      toast(e.message, 'error');
    }
  }

  async function loadCurrentNotebook() {
    const sel = document.getElementById('study-notebook-sel');
    const path = sel.value;
    if (!path) return;
    currentFile = path;
    localStorage.setItem('study_last_file', path);
    showLoading();
    try {
      const text = await GitHubModule.readFile(path);
      allWords = parseWords(text, path);
      buildCountInput();
      selectedStudyCount = null;
      // 필터 입력 초기화
      const inp = document.getElementById('study-count-filter');
      if (inp) inp.value = '';
      renderWords();
      toast(`${allWords.length}개 단어 로드 완료`, 'success');
    } catch(e) {
      showStatus('❌', '파일 로드 실패', e.message);
      toast(e.message, 'error');
    }
  }

  /* ── 파싱 ── */
  function parseWords(text, filePath) {
    // 줄 단위로 "---" 만 있는 줄을 구분자로 분리
    const blocks = [];
    let cur = [];
    for (const line of text.split('\n')) {
      if (/^\s*---\s*$/.test(line)) {
        if (cur.length) blocks.push(cur.join('\n'));
        cur = [];
      } else {
        cur.push(line);
      }
    }
    if (cur.length) blocks.push(cur.join('\n'));

    const words = [];
    blocks.forEach((block, idx) => {
      const w = { _file: filePath, _idx: idx };
      block.split('\n').forEach(line => {
        const m = line.match(/^([^:：]+)[：:]\s*(.*)$/);
        if (!m) return;
        const k = m[1].trim();
        // 마크다운 굵게(**text**, __text__) 및 기울임(*text*, _text_) 제거
        const v = m[2].trim().replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/_([^_]+)_/g,'$1');
        if (k === '라오')     w.lao = v;
        if (k === '발음')     w.pron = v;
        if (k === '한글')     w.kor = v;
        if (k === '영어')     w.eng = v;
        if (k === '반대말')   w.opp = v;
        if (k === '음성')     w.audio = v;
        if (k === '공부횟수') w.studyCount = Math.min(MAX_STUDY, parseInt(v) || 0);
      });
      // 로컬 카운트 우선
      const lk = `${filePath}::${idx}`;
      if (localCounts[lk] !== undefined) w.studyCount = localCounts[lk];
      if (w.lao || w.kor || w.eng) words.push(w);
    });
    return words;
  }

  /* ── 공부횟수 필터 — 숫자 입력 (max 7) ── */
  function buildCountInput() {
    // 이미 있으면 그대로 (동적 생성 불필요, HTML에서 고정)
  }

  function getStudyFilter() {
    const inp = document.getElementById('study-count-filter');
    if (!inp || inp.value === '') return null;
    return Math.min(MAX_STUDY, Math.max(0, parseInt(inp.value) || 0));
  }

  function onCountFilterChange() {
    selectedStudyCount = getStudyFilter();
    renderWords();
  }

  /* ── 표시갯수 ── */
  function getDisplayCount() {
    return Math.min(100, Math.max(1, parseInt(document.getElementById('study-display-count').value) || 20));
  }

  /* ── 렌더링 ── */
  function renderWords() {
    selectedStudyCount = getStudyFilter();

    let filtered = selectedStudyCount === null
      ? [...allWords]
      : allWords.filter(w => (w.studyCount || 0) <= selectedStudyCount);

    const n = getDisplayCount();
    const shown = filtered.slice(0, n);

    // 통계
    const sb = document.getElementById('study-stats');
    if (allWords.length) {
      sb.style.display = 'flex';
      document.getElementById('st-total').textContent   = allWords.length;
      document.getElementById('st-shown').textContent   = shown.length;
      document.getElementById('st-studied').textContent = allWords.filter(w => (w.studyCount||0) > 0).length;
      document.getElementById('st-range').textContent   = `${shown.length} / ${filtered.length}개 표시`;
    } else {
      sb.style.display = 'none';
    }

    const area = document.getElementById('study-words');
    if (!shown.length) {
      area.innerHTML = `<div class="s-status"><div class="s-icon">🔍</div>
        <h3>표시할 단어가 없습니다</h3>
        <p>공부횟수 필터나 표시 개수를 조정해 보세요.</p></div>`;
      return;
    }
    area.innerHTML = shown.map(w => cardHTML(w)).join('');
  }

  function cardHTML(w) {
    const lk = `${w._file}::${w._idx}`;
    const lkSafe = lk.replace(/[^a-zA-Z0-9]/g, '_');
    const cnt = w.studyCount || 0;
    // 전체 토글 상태: hidden이면 블러
    const cls = col => colVis[col] ? 's-cell' : 's-cell vis-hidden';
    // 셀 클릭 → 개별 토글 (해당 카드의 해당 열만)
    const clickCls = 's-cell-click';
    return `
    <div class="s-card" id="sc_${lkSafe}">
      <button class="s-audio-btn" onclick="StudyModule.playAudio('${w.audio||''}','${lk}')"
        ${!w.audio ? 'disabled' : ''} title="발음 듣기">🔊</button>

      <div class="${cls('lao')} ${clickCls}" onclick="StudyModule.toggleCell(this)" title="클릭하여 가리기/보기">
        <div class="s-lao">${esc(w.lao||'—')}</div>
      </div>

      <div class="${cls('eng')} ${clickCls}" onclick="StudyModule.toggleCell(this)" title="클릭하여 가리기/보기">
        <div class="s-eng">${esc(w.eng||'—')}</div>
      </div>

      <div class="${cls('kor')} ${clickCls}" onclick="StudyModule.toggleCell(this)" title="클릭하여 가리기/보기">
        <div class="s-kor">${esc(w.kor||'—')}</div>
      </div>

      <div class="${cls('pron')} ${clickCls}" onclick="StudyModule.toggleCell(this)" title="클릭하여 가리기/보기">
        <div class="s-pron" style="font-size:calc(var(--study-fs, 15px) - 2px)">${esc(w.pron||'—')}</div>
      </div>

      <div class="s-study-ctrl">
        <div class="s-count-display" title="공부횟수">${cnt}</div>
        <div class="s-count-btns">
          <button class="s-inc-btn" onclick="StudyModule.changeCount('${lk}', 1)"  title="+1">＋</button>
          <button class="s-dec-btn" onclick="StudyModule.changeCount('${lk}', -1)" title="-1">－</button>
          <button class="s-set-btn" onclick="StudyModule.setCountInline('${lk}')"  title="직접 입력">✎</button>
        </div>
      </div>
    </div>`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── 전체 토글 (3단 버튼) ── */
  function toggleCol(col) {
    colVis[col] = !colVis[col];
    document.getElementById('stog-' + col).classList.toggle('on', colVis[col]);
    // 모든 카드의 해당 열 일괄 적용
    // col 순서: lao=2번째, eng=3번째, kor=4번째, pron=5번째 s-cell
    const colIdx = { lao: 0, eng: 1, kor: 2, pron: 3 };
    const idx = colIdx[col];
    document.querySelectorAll('#study-words .s-card').forEach(card => {
      const cells = card.querySelectorAll('.s-cell');
      if (cells[idx]) {
        cells[idx].classList.toggle('vis-hidden', !colVis[col]);
        // 전체 토글 시 개별 토글 상태 초기화
        cells[idx].dataset.hidden = '';
      }
    });
  }

  /* ── 개별 셀 클릭 토글 ── */
  function toggleCell(cellEl) {
    // vis-hidden 토글
    const isHidden = cellEl.classList.contains('vis-hidden');
    cellEl.classList.toggle('vis-hidden', !isHidden);
    cellEl.dataset.hidden = isHidden ? '' : '1';
  }

  /* ── 음성 ── */
  function getAudioUrl(filename) {
    const cfg = GitHubModule.get();
    return `https://raw.githubusercontent.com/${cfg.user}/${cfg.repo}/${cfg.branch}/audio/${filename}`;
  }

  function playAudio(filename) {
    if (!filename) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const a = new Audio(getAudioUrl(filename));
    currentAudio = a;
    a.play().catch(() => toast('음성 파일을 찾을 수 없습니다', 'error'));
  }

  function playAll() {
    const shown = getCurrentShown();
    let i = 0;
    function next() {
      if (i >= shown.length) return;
      const w = shown[i++];
      if (!w.audio) { next(); return; }
      const a = new Audio(getAudioUrl(w.audio));
      a.onended = next;
      a.play().catch(next);
    }
    next();
  }

  function getCurrentShown() {
    const filtered = selectedStudyCount === null
      ? [...allWords]
      : allWords.filter(w => (w.studyCount||0) <= selectedStudyCount);
    return filtered.slice(0, getDisplayCount());
  }

  /* ── 공부횟수 변경 ── */
  async function changeCount(lk, delta) {
    const word = findWord(lk);
    if (!word) return;
    word.studyCount = Math.min(MAX_STUDY, Math.max(0, (word.studyCount || 0) + delta));
    localCounts[lk] = word.studyCount;
    saveLocalCounts();
    updateCardCount(lk, word.studyCount);
    await trySaveGitHub(word);
  }

  /* 카드 내 인라인 숫자 입력으로 직접 설정 */
  function setCountInline(lk) {
    const id = 'sc_' + lk.replace(/[^a-zA-Z0-9]/g, '_');
    const ctrl = document.getElementById(id)?.querySelector('.s-study-ctrl');
    if (!ctrl) return;
    const word = findWord(lk);
    if (!word) return;

    const cur = word.studyCount || 0;
    ctrl.innerHTML = `
      <input id="inline-inp-${id}" type="number" min="0" max="${MAX_STUDY}" value="${cur}"
        style="width:52px;padding:4px;border-radius:6px;border:1px solid var(--accent);background:var(--bg3);color:var(--accent);font-size:16px;font-family:monospace;text-align:center;outline:none"
        onkeydown="if(event.key==='Enter')StudyModule.confirmInline('${lk}','${id}');if(event.key==='Escape')StudyModule.cancelInline('${lk}','${id}',${cur})"
      >
      <div class="s-count-btns" style="margin-top:2px">
        <button class="s-inc-btn" onclick="StudyModule.confirmInline('${lk}','${id}')" title="확인" style="background:var(--accent3);color:#000;border-color:var(--accent3)">✓</button>
        <button class="s-dec-btn" onclick="StudyModule.cancelInline('${lk}','${id}',${cur})" title="취소" style="font-size:12px">✕</button>
      </div>`;
    setTimeout(() => document.getElementById(`inline-inp-${id}`)?.focus(), 0);
  }

  async function confirmInline(lk, id) {
    const inp = document.getElementById(`inline-inp-${id}`);
    if (!inp) return;
    const n = Math.min(MAX_STUDY, Math.max(0, parseInt(inp.value) || 0));
    const word = findWord(lk);
    if (!word) return;
    word.studyCount = n;
    localCounts[lk] = n;
    saveLocalCounts();
    // 컨트롤 복원
    restoreCtrl(id, lk, n);
    await trySaveGitHub(word);
  }

  function cancelInline(lk, id, prev) {
    restoreCtrl(id, lk, prev);
  }

  function restoreCtrl(id, lk, cnt) {
    const ctrl = document.getElementById(id)?.querySelector('.s-study-ctrl');
    if (!ctrl) return;
    ctrl.innerHTML = `
      <div class="s-count-display" title="공부횟수">${cnt}</div>
      <div class="s-count-btns">
        <button class="s-inc-btn" onclick="StudyModule.changeCount('${lk}', 1)"  title="+1">＋</button>
        <button class="s-dec-btn" onclick="StudyModule.changeCount('${lk}', -1)" title="-1">－</button>
        <button class="s-set-btn" onclick="StudyModule.setCountInline('${lk}')"  title="직접 입력">✎</button>
      </div>`;
  }

  function findWord(lk) {
    const [file, idxStr] = lk.split('::');
    return allWords.find(w => w._file === file && w._idx === parseInt(idxStr));
  }

  function updateCardCount(lk, count) {
    const id = 'sc_' + lk.replace(/[^a-zA-Z0-9]/g, '_');
    const el = document.getElementById(id)?.querySelector('.s-count-display');
    if (el) {
      el.textContent = count;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 300);
    }
  }

  /* ── GitHub 저장 ── */
  async function trySaveGitHub(word) {
    if (!GitHubModule.get().token || !currentFile) return;
    try {
      const text = await GitHubModule.readFile(currentFile);
      const updated = updateCountInText(text, word);
      await GitHubModule.writeFile(currentFile, updated, `공부횟수: ${word.lao||''} → ${word.studyCount}회`);
      toast(`✓ GitHub 저장 (${word.studyCount}회)`, 'success');
    } catch(e) {
      toast('로컬 저장됨 (GitHub 오류: ' + e.message + ')', '');
    }
  }

  function updateCountInText(text, word) {
    if (!word.lao) return text;
    const laoEsc = word.lao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(라오\\s*[：:]\\s*${laoEsc}[\\s\\S]*?공부횟수\\s*[：:]\\s*)\\d+`, 'g'
    );
    return text.replace(re, `$1${word.studyCount}`);
  }

  /* ── UI 헬퍼 ── */
  function showLoading() {
    document.getElementById('study-words').innerHTML =
      `<div class="s-status"><div class="s-loader"></div><h3>단어장 로딩 중…</h3></div>`;
    document.getElementById('study-stats').style.display = 'none';
  }

  function showStatus(icon, title, msg) {
    document.getElementById('study-words').innerHTML =
      `<div class="s-status"><div class="s-icon">${icon}</div><h3>${title}</h3><p>${msg}</p></div>`;
  }

  function toast(msg, type) { AppToast.show(msg, type); }

  function clearLocal() {
    if (!confirm('로컬 공부횟수 데이터를 모두 삭제하시겠습니까?')) return;
    localStorage.removeItem(LOCAL_KEY);
    localCounts = {};
    if (currentFile) loadCurrentNotebook();
    toast('로컬 데이터 삭제 완료', '');
  }

  function init() { loadLocalCounts(); }

  return {
    init, loadNotebooks, loadCurrentNotebook, renderWords,
    onCountFilterChange, toggleCol, toggleCell, playAudio, playAll,
    changeCount, setCountInline, confirmInline, cancelInline, clearLocal,
  };
})();
