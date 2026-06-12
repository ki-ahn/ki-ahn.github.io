/**
 * study.js — 단어공부 모듈
 * GitHubModule에 의존
 */
const StudyModule = (() => {

  /* ── 상태 ── */
  let allWords = [];
  let currentFile = null;
  let selectedStudyCount = null;
  let colVis = { lao: true, eng: true, kor: true, opp: true };
  let currentAudio = null;
  let notebookFiles = [];

  const MAX_STUDY = 7;

  /* ── 로컬 카운트: 사용 안 함 — 원본 .md 파일 기준 ── */
  function loadLocalCounts() {}
  function saveLocalCounts() {}

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
      currentPage = 1;  // 새 노트 로드 시 첫 페이지
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
      if (w.lao || w.kor || w.eng) words.push(w);
    });
    return words;
  }

  let currentPage = 1;  // 현재 페이지

  /* ── 공부횟수 필터 상태 ── */
  let _filterVal   = null;  // null=전체, 0~7
  let _displayVal  = 20;    // 표시갯수

  function buildCountInput() {}

  function getStudyFilter() { return _filterVal; }

  function getDisplayCount() { return _displayVal; }

  /* 공부횟수 스테퍼 */
  function stepFilter(delta) {
    if (_filterVal === null) {
      _filterVal = delta > 0 ? 0 : MAX_STUDY;
    } else {
      _filterVal += delta;
      if (_filterVal < 0)          _filterVal = null;
      if (_filterVal > MAX_STUDY)  _filterVal = MAX_STUDY;
    }
    _updateFilterDisplay();
    currentPage = 1;
    renderWords();
  }

  function _updateFilterDisplay() {
    const el = document.getElementById('study-count-filter-display');
    if (el) el.textContent = (_filterVal === null || _filterVal === undefined) ? '전체' : String(_filterVal);
  }

  /* 표시갯수 스테퍼 — 5씩 증감, 1~100 */
  function stepDisplay(delta) {
    _displayVal = Math.min(100, Math.max(1, _displayVal + delta * 5));
    const el = document.getElementById('study-display-count-display');
    if (el) el.textContent = String(_displayVal);
    currentPage = 1;
    renderWords();
  }

  function onCountFilterChange() {
    currentPage = 1;
    renderWords();
  }

  /* ── 페이지 이동 ── */
  function goPage(p) {
    currentPage = p;
    renderWords();
    // 단어 목록 맨 위로 스크롤
    const area = document.getElementById('study-words');
    if (area) area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── 렌더링 ── */
  function renderWords() {
    // _filterVal 직접 사용 (getStudyFilter() 재호출로 인한 혼동 방지)
    const filterVal = _filterVal;

    // 필터 적용 — 0도 유효한 값이므로 null 여부를 엄격하게 체크
    const filtered = (filterVal === null || filterVal === undefined)
      ? [...allWords]
      : allWords.filter(w => (w.studyCount !== undefined ? w.studyCount : 0) <= filterVal);

    const pageSize  = getDisplayCount();
    const totalPage = Math.max(1, Math.ceil(filtered.length / pageSize));

    // 페이지 범위 보정
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPage) currentPage = totalPage;

    const start = (currentPage - 1) * pageSize;
    const shown = filtered.slice(start, start + pageSize);

    // 통계
    const sb = document.getElementById('study-stats');
    if (allWords.length) {
      sb.style.display = 'flex';
      document.getElementById('st-total').textContent   = allWords.length;
      document.getElementById('st-shown').textContent   = filtered.length;
      document.getElementById('st-studied').textContent = allWords.filter(w => (w.studyCount||0) > 0).length;
      document.getElementById('st-range').textContent   =
        filtered.length === 0 ? '0개' :
        `${start + 1}–${Math.min(start + pageSize, filtered.length)} / ${filtered.length}개`;
    } else {
      sb.style.display = 'none';
    }

    const area = document.getElementById('study-words');
    if (!shown.length) {
      area.innerHTML = `<div class="s-status"><div class="s-icon">🔍</div>
        <h3>표시할 단어가 없습니다</h3>
        <p>공부횟수 필터나 표시 개수를 조정해 보세요.</p></div>`;
      renderPagination(0, 1, 1);
      return;
    }

    area.innerHTML = shown.map(w => cardHTML(w)).join('');
    renderPagination(filtered.length, pageSize, totalPage);
  }

  /* ── 페이지네이션 버튼 렌더링 ── */
  function renderPagination(total, pageSize, totalPage) {
    const bar = document.getElementById('study-pagination');
    if (!bar) return;
    if (totalPage <= 1) { bar.innerHTML = ''; return; }

    // 표시할 페이지 번호 범위 계산 (현재 기준 앞뒤 2페이지)
    const delta = 2;
    const pages = [];
    for (let i = 1; i <= totalPage; i++) {
      if (i === 1 || i === totalPage ||
          (i >= currentPage - delta && i <= currentPage + delta)) {
        pages.push(i);
      }
    }

    let html = `<button class="pg-btn" onclick="StudyModule.goPage(${currentPage - 1})"
      ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;

    let prev = null;
    pages.forEach(p => {
      if (prev !== null && p - prev > 1) {
        html += `<span class="pg-ellipsis">…</span>`;
      }
      html += `<button class="pg-btn ${p === currentPage ? 'active' : ''}"
        onclick="StudyModule.goPage(${p})">${p}</button>`;
      prev = p;
    });

    html += `<button class="pg-btn" onclick="StudyModule.goPage(${currentPage + 1})"
      ${currentPage === totalPage ? 'disabled' : ''}>›</button>`;

    bar.innerHTML = html;
  }

  function cardHTML(w) {
    const lk = `${w._file}::${w._idx}`;
    const lkSafe = lk.replace(/[^a-zA-Z0-9]/g, '_');
    const cnt = w.studyCount || 0;
    const cellCls = col => 's-cell s-cell-click' + (colVis[col] ? '' : ' vis-hidden');
    return `
    <div class="s-card" id="sc_${lkSafe}">
      <button class="s-audio-btn" onclick="StudyModule.playAudio('${w.audio||''}','${lk}')"
        ${!w.audio ? 'disabled' : ''} title="발음 듣기">🔊</button>

      <div class="${cellCls('lao')}" onclick="StudyModule.toggleCell(this)" title="클릭: 가리기/보기">
        <div class="s-lao">${esc(w.lao||'—')}</div>
        <div class="s-pron">${esc(w.pron||'')}</div>
      </div>

      <div class="${cellCls('eng')}" onclick="StudyModule.toggleCell(this)" title="클릭: 가리기/보기">
        <div class="s-eng">${esc(w.eng||'—')}</div>
      </div>

      <div class="${cellCls('kor')}" onclick="StudyModule.toggleCell(this)" title="클릭: 가리기/보기">
        <div class="s-kor">${esc(w.kor||'—')}</div>
      </div>

      <div class="${cellCls('opp')}" onclick="StudyModule.toggleCell(this)" title="클릭: 가리기/보기">
        <div class="s-opp">${esc(w.opp||'—')}</div>
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
    const colIdx = { lao: 0, eng: 1, kor: 2, opp: 3 };
    const idx = colIdx[col];
    document.querySelectorAll('#study-words .s-card').forEach(card => {
      const cells = card.querySelectorAll('.s-cell-click');
      if (cells[idx]) {
        cells[idx].classList.toggle('vis-hidden', !colVis[col]);
        // 전체 토글 시 개별 상태 초기화
        delete cells[idx].dataset.cellHidden;
      }
    });
  }

  /* ── 개별 셀 클릭 토글 ── */
  function toggleCell(cellEl) {
    // vis-hidden이 있으면 제거(보이기), 없으면 추가(가리기)
    if (cellEl.classList.contains('vis-hidden')) {
      cellEl.classList.remove('vis-hidden');
      delete cellEl.dataset.cellHidden;
    } else {
      cellEl.classList.add('vis-hidden');
      cellEl.dataset.cellHidden = '1';
    }
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
    const filtered = (_filterVal === null || _filterVal === undefined)
      ? [...allWords]
      : allWords.filter(w => (w.studyCount !== undefined ? w.studyCount : 0) <= _filterVal);
    return filtered.slice(0, getDisplayCount());
  }

  /* ── 공부횟수 변경 ── */
  async function changeCount(lk, delta) {
    const word = findWord(lk);
    if (!word) return;
    word.studyCount = Math.min(MAX_STUDY, Math.max(0, (word.studyCount !== undefined ? word.studyCount : 0) + delta));
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
  /* ── GitHub 저장 (SHA 직접 전달로 중복 API 호출 제거) ── */
  let _saveQueue = Promise.resolve();  // 저장 큐 — 연속 클릭 시 순서 보장

  async function trySaveGitHub(word) {
    if (!GitHubModule.get().token || !currentFile) return;

    // 큐에 추가하여 순서대로 실행 (이전 저장 완료 후 다음 실행)
    _saveQueue = _saveQueue.then(async () => {
      try {
        // 파일 읽기 + SHA 한 번에
        const { text, sha } = await GitHubModule.readFileWithSha(currentFile);
        const updated = updateCountInText(text, word);
        // SHA 직접 전달 → writeFile 내부에서 추가 fetchContents 호출 안 함
        await GitHubModule.writeFile(
          currentFile, updated,
          `공부횟수: ${word.lao||''} → ${word.studyCount}회`,
          sha
        );
        toast(`✓ GitHub 저장 (${word.studyCount}회)`, 'success');
      } catch(e) {
        toast('GitHub 저장 오류: ' + e.message, 'error');
      }
    });

    return _saveQueue;
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
    // 로컬 저장 방식 제거됨 — 원본 .md 파일 기준으로만 동작
    // 기존 로컬 데이터가 남아있다면 정리
    try { localStorage.removeItem('study_counts'); } catch(e) {}
    if (currentFile) loadCurrentNotebook();
    toast('노트를 새로 불러왔습니다', '');
  }

  function init() {
    // 기존에 로컬에 저장된 공부횟수 데이터 자동 정리
    try { localStorage.removeItem('study_counts'); } catch(e) {}
  }

  return {
    init, loadNotebooks, loadCurrentNotebook, renderWords, goPage,
    onCountFilterChange, stepFilter, stepDisplay,
    toggleCol, toggleCell, playAudio, playAll,
    changeCount, setCountInline, confirmInline, cancelInline, clearLocal,
  };
})();
