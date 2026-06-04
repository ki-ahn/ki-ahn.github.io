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
  let colVis = { lao: true, eng: true, kor: true, opp: true };
  let currentAudio = null;
  let notebookFiles = [];

  const LOCAL_KEY = 'study_counts';

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
        .filter(f => !cfg.bibleFolder || !f.path.startsWith(cfg.bibleFolder + '/'))
        .filter(f => !cfg.wordsFolder || f.path.startsWith(cfg.wordsFolder + '/') ||
                     (!cfg.wordsFolder && true));

      // wordsFolder 가 설정된 경우 그 폴더만
      if (cfg.wordsFolder) {
        notebookFiles = notebookFiles.filter(f => f.path.startsWith(cfg.wordsFolder + '/'));
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
      buildChips();
      selectedStudyCount = null;
      renderWords();
      toast(`${allWords.length}개 단어 로드 완료`, 'success');
    } catch(e) {
      showStatus('❌', '파일 로드 실패', e.message);
      toast(e.message, 'error');
    }
  }

  /* ── 파싱 ── */
  function parseWords(text, filePath) {
    // "---" 구분자로 분리 (앞뒤 공백 포함 다양한 패턴 허용)
    const blocks = text.split(/\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/gm)
                       .map(b => b.trim()).filter(Boolean);
    const words = [];
    blocks.forEach((block, idx) => {
      const w = { _file: filePath, _idx: idx };
      block.split('\n').forEach(line => {
        const m = line.match(/^([^:：]+)[：:]\s*(.*)$/);
        if (!m) return;
        const k = m[1].trim(), v = m[2].trim();
        if (k === '라오')    w.lao = v;
        if (k === '발음')    w.pron = v;
        if (k === '한글')    w.kor = v;
        if (k === '영어')    w.eng = v;
        if (k === '반대말')  w.opp = v;
        if (k === '음성')    w.audio = v;
        if (k === '공부횟수') w.studyCount = parseInt(v) || 0;
      });
      // 로컬 카운트 우선
      const lk = `${filePath}::${idx}`;
      if (localCounts[lk] !== undefined) w.studyCount = localCounts[lk];
      if (w.lao || w.kor || w.eng) words.push(w);
    });
    return words;
  }

  /* ── 공부횟수 칩 ── */
  function buildChips() {
    const max = Math.max(0, ...allWords.map(w => w.studyCount || 0));
    const cont = document.getElementById('study-count-chips');
    const vals = ['전체', ...Array.from({length: max + 1}, (_, i) => i)];
    cont.innerHTML = vals.map(v =>
      `<div class="s-chip${v === '전체' ? ' active' : ''}" data-val="${v}"
        onclick="StudyModule.selectCount(this,'${v}')">${v}</div>`
    ).join('');
  }

  function selectCount(el, val) {
    document.querySelectorAll('.s-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedStudyCount = (val === '전체') ? null : parseInt(val);
    renderWords();
  }

  /* ── 표시갯수 ── */
  function getDisplayCount() {
    return Math.min(100, Math.max(1, parseInt(document.getElementById('study-display-count').value) || 20));
  }

  /* ── 렌더링 ── */
  function renderWords() {
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

    const area = document.getElementById('study-words-area');
    if (!shown.length) {
      area.innerHTML = `<div class="s-status"><div class="s-icon">🔍</div>
        <h3>표시할 단어가 없습니다</h3>
        <p>공부횟수 필터나 표시 개수를 조정해 보세요.</p></div>`;
      return;
    }
    area.innerHTML = shown.map((w, i) => cardHTML(w, i)).join('');
  }

  function cardHTML(w) {
    const lk = `${w._file}::${w._idx}`;
    const lkSafe = lk.replace(/[^a-zA-Z0-9]/g, '_');
    const cnt = w.studyCount || 0;
    const hide = (col) => colVis[col] ? '' : 'vis-hidden';
    return `
    <div class="s-card" id="sc_${lkSafe}">
      <button class="s-audio-btn" onclick="StudyModule.playAudio('${w.audio||''}','${lk}')"
        ${!w.audio ? 'disabled' : ''} title="발음 듣기">🔊</button>

      <div class="s-cell ${hide('lao')}">
        <div class="s-lao">${esc(w.lao||'—')}</div>
        <div class="s-pron">${esc(w.pron||'')}</div>
      </div>

      <div class="s-cell ${hide('eng')}">
        <div class="s-eng">${esc(w.eng||'—')}</div>
      </div>

      <div class="s-cell ${hide('kor')}">
        <div class="s-kor">${esc(w.kor||'—')}</div>
      </div>

      <div class="s-cell ${hide('opp')}">
        <div class="s-opp">${esc(w.opp||'—')}</div>
      </div>

      <div class="s-study-ctrl">
        <div class="s-count-display" title="공부횟수">${cnt}</div>
        <div class="s-count-btns">
          <button class="s-inc-btn" onclick="StudyModule.changeCount('${lk}', 1)" title="횟수 +1">＋</button>
          <button class="s-dec-btn" onclick="StudyModule.changeCount('${lk}', -1)" title="횟수 -1">－</button>
          <button class="s-set-btn" onclick="StudyModule.promptCount('${lk}')" title="직접 입력">✎</button>
        </div>
      </div>
    </div>`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── 토글 ── */
  function toggleCol(col) {
    colVis[col] = !colVis[col];
    document.getElementById('stog-' + col).classList.toggle('on', colVis[col]);
    renderWords();
  }

  /* ── 음성 ── */
  function getAudioUrl(filename) {
    const cfg = GitHubModule.get();
    return `https://raw.githubusercontent.com/${cfg.user}/${cfg.repo}/${cfg.branch}/audio/${filename}`;
  }

  function playAudio(filename, lk) {
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
    const [file, idxStr] = lk.split('::');
    const idx = parseInt(idxStr);
    const word = allWords.find(w => w._file === file && w._idx === idx);
    if (!word) return;

    word.studyCount = Math.max(0, (word.studyCount || 0) + delta);
    localCounts[lk] = word.studyCount;
    saveLocalCounts();
    updateCardCount(lk, word.studyCount);
    buildChips();
    restoreChipSelection();
    await trySaveGitHub(lk, word);
  }

  async function promptCount(lk) {
    const [file, idxStr] = lk.split('::');
    const idx = parseInt(idxStr);
    const word = allWords.find(w => w._file === file && w._idx === idx);
    if (!word) return;
    const cur = word.studyCount || 0;
    const inp = prompt(`공부횟수를 입력하세요 (현재: ${cur})`, cur);
    if (inp === null) return;
    const n = parseInt(inp);
    if (isNaN(n) || n < 0) { toast('0 이상의 숫자를 입력하세요', 'error'); return; }
    word.studyCount = n;
    localCounts[lk] = n;
    saveLocalCounts();
    updateCardCount(lk, n);
    buildChips();
    restoreChipSelection();
    await trySaveGitHub(lk, word);
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

  function restoreChipSelection() {
    document.querySelectorAll('.s-chip').forEach(c => {
      const v = c.dataset.val;
      const isActive = (selectedStudyCount === null && v === '전체') ||
                       (selectedStudyCount !== null && parseInt(v) === selectedStudyCount);
      c.classList.toggle('active', isActive);
    });
  }

  /* ── GitHub 저장 ── */
  async function trySaveGitHub(lk, word) {
    if (!GitHubModule.get().token) return;
    if (!currentFile) return;
    try {
      const text = await GitHubModule.readFile(currentFile);
      const updated = updateCountInText(text, word);
      await GitHubModule.writeFile(currentFile, updated, `공부횟수: ${word.lao||''} → ${word.studyCount}회`);
      toast(`✓ GitHub 저장 완료 (${word.studyCount}회)`, 'success');
    } catch(e) {
      toast('로컬 저장됨 (GitHub: ' + e.message + ')', '');
    }
  }

  function updateCountInText(text, word) {
    if (!word.lao) return text;
    const laoEsc = word.lao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 해당 라오 단어가 있는 블록의 공부횟수 업데이트
    const re = new RegExp(
      `(라오\\s*[：:]\\s*${laoEsc}[\\s\\S]*?공부횟수\\s*[：:]\\s*)\\d+`,
      'g'
    );
    return text.replace(re, `$1${word.studyCount}`);
  }

  /* ── UI 헬퍼 ── */
  function showLoading() {
    document.getElementById('study-words-area').innerHTML =
      `<div class="s-status"><div class="s-loader"></div><h3>단어장 로딩 중…</h3></div>`;
    document.getElementById('study-stats').style.display = 'none';
  }

  function showStatus(icon, title, msg) {
    document.getElementById('study-words-area').innerHTML =
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

  /* ── 초기화 ── */
  function init() {
    loadLocalCounts();
  }

  return {
    init, loadNotebooks, loadCurrentNotebook,
    selectCount, toggleCol, playAudio, playAll,
    changeCount, promptCount, clearLocal,
  };
})();
