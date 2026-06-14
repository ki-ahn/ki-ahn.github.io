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

    // 다른 노트로 이동 전 미저장 데이터 GitHub에 저장
    if (_isDirty && currentFile && currentFile !== path) {
      await _doSave('notebook-change');
    }

    currentFile = path;
    _lastSha = null;  // 새 파일이므로 SHA 캐시 초기화
    localStorage.setItem('study_last_file', path);
    showLoading();
    try {
      const text = await GitHubModule.readFile(path);
      allWords = parseWords(text, path);
      // 로컬에 미저장 데이터 있으면 복원
      const hadPending = _restoreLocal();
      buildCountInput();
      selectedStudyCount = null;
      currentPage = 1;
      const inp = document.getElementById('study-count-filter');
      if (inp) inp.value = '';
      renderWords();
      if (hadPending) toast('⚠ 미저장 공부횟수 복원됨 — 탭 이동 or 10분 후 자동 저장', '');
      else toast(`${allWords.length}개 단어 로드 완료`, 'success');
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
  /* ── 저장 전략 ──
     - ＋/－ 클릭: 메모리 + localStorage 즉시 저장, 저장 버튼 활성화
     - 저장 버튼 클릭: GitHub에 전체 저장
     - 탭 이동 / 앱 종료: GitHub에 자동 저장
     - 앱 재시작: localStorage 미저장 데이터 자동 복원
  ── */
  const SAVE_KEY = 'study_pending';
  let _isDirty   = false;

  /* 저장 버튼 상태 업데이트 */
  function _updateSaveBtn() {
    const btn = document.getElementById('study-save-btn');
    if (!btn) return;
    if (_isDirty) {
      btn.classList.add('dirty');
      btn.textContent = '💾 저장 *';
      btn.title = '미저장 공부횟수 있음 — 클릭하여 GitHub 저장';
    } else {
      btn.classList.remove('dirty');
      btn.textContent = '💾 저장';
      btn.title = '공부횟수를 GitHub에 저장';
    }
  }

  /* 로컬 백업 저장 */
  function _saveLocal() {
    if (!currentFile) return;
    const counts = {};
    allWords.forEach(w => { counts[w._idx] = w.studyCount || 0; });
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ file: currentFile, counts, ts: Date.now() }));
    } catch(e) {}
  }

  /* 로컬 백업 복원 — 같은 파일이면 메모리에 반영, 복원 여부 반환 */
  function _restoreLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const { file, counts } = JSON.parse(raw);
      if (file !== currentFile) return false;
      allWords.forEach(w => {
        if (counts[w._idx] !== undefined) w.studyCount = counts[w._idx];
      });
      _isDirty = true;
      _updateSaveBtn();
      return true;
    } catch(e) { return false; }
  }

  let _lastSha = null;  // 마지막 저장 후 받은 최신 SHA 캐시

  /* GitHub에 전체 저장 */
  async function _doSave(showToast = true) {
    if (!_isDirty) return;
    if (!GitHubModule.get().token || !currentFile) {
      toast('GitHub 토큰을 설정하세요', 'error');
      return;
    }
    const btn = document.getElementById('study-save-btn');
    if (btn) { btn.textContent = '⏳ 저장 중…'; btn.disabled = true; }
    try {
      // 항상 최신 SHA를 서버에서 가져옴 (캐시 방지는 fetchContents에서 처리)
      const { text, sha } = await GitHubModule.readFileWithSha(currentFile);
      const updated = updateAllCounts(text);
      if (updated === text) {
        _isDirty = false;
        localStorage.removeItem(SAVE_KEY);
        _updateSaveBtn();
        if (showToast) toast('변경 내용이 없습니다', '');
        if (btn) btn.disabled = false;
        return;
      }
      const res = await GitHubModule.writeFile(currentFile, updated, '공부횟수 업데이트', sha);
      // PUT 응답에서 새 SHA 캐시 → 다음 저장 시 재사용
      _lastSha = res?.newSha || res?.content?.sha || null;
      _isDirty = false;
      localStorage.removeItem(SAVE_KEY);
      _updateSaveBtn();
      if (showToast) toast('✓ GitHub 저장 완료', 'success');
    } catch(e) {
      _lastSha = null;  // SHA 오류 시 초기화
      if (btn) { btn.classList.add('dirty'); }
      toast('저장 오류: ' + e.message, 'error');
    }
    if (btn) btn.disabled = false;
  }

  /* 저장 버튼 클릭 */
  async function saveNow() { await _doSave(true); }

  async function trySaveGitHub(word) {
    _isDirty = true;
    _saveLocal();
    _updateSaveBtn();
  }

  /* 메모리의 모든 단어 공부횟수를 텍스트에 반영 */
  function updateAllCounts(text) {
    const lines = text.split('\n');
    const result = [];
    let blockLines = [];
    let blockIdx = 0;

    function flushBlock() {
      const word = allWords.find(w => w._idx === blockIdx);
      if (word !== undefined) {
        const replaced = blockLines.map(l => {
          if (/^\s*공부횟수\s*[：:]/.test(l)) {
            return l.replace(/(\s*공부횟수\s*[：:]\s*)\d+/, `$1${word.studyCount || 0}`);
          }
          return l;
        });
        result.push(...replaced);
      } else {
        result.push(...blockLines);
      }
      blockLines = [];
      blockIdx++;
    }

    for (const line of lines) {
      if (/^\s*---\s*$/.test(line)) {
        flushBlock();
        result.push(line);
      } else {
        blockLines.push(line);
      }
    }
    if (blockLines.length) flushBlock();
    return result.join('\n');
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
    // 탭 비활성화 / 앱 종료 시 자동 저장
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && _isDirty) _doSave(false);
    });
    window.addEventListener('beforeunload', () => {
      if (_isDirty) _doSave(false);
    });
  }

  return {
    init, loadNotebooks, loadCurrentNotebook, renderWords, goPage,
    onCountFilterChange, stepFilter, stepDisplay, saveNow,
    toggleCol, toggleCell, playAudio, playAll,
    changeCount, setCountInline, confirmInline, cancelInline, clearLocal,
  };
})();
