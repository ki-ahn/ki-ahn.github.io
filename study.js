/**
 * study.js — 단어공부 모듈 (책보기 레이아웃)
 * GitHubModule에 의존
 */
const StudyModule = (() => {

  /* ── 상태 ── */
  let allWords    = [];
  let currentFile = null;
  let colVis      = { lao: true, eng: true, kor: true };
  let currentAudio = null;
  let notebookFiles = [];
  const MAX_STUDY  = 7;

  /* ── 저장 전략 ── */
  const SAVE_KEY  = 'study_pending';
  let _isDirty    = false;
  let _lastSha    = null;

  function _saveLocal() {
    if (!currentFile) return;
    const counts = {};
    allWords.forEach(w => { counts[w._idx] = w.studyCount || 0; });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ file: currentFile, counts })); } catch(e) {}
  }

  function _restoreLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const { file, counts } = JSON.parse(raw);
      if (file !== currentFile) return false;
      allWords.forEach(w => { if (counts[w._idx] !== undefined) w.studyCount = counts[w._idx]; });
      _isDirty = true;
      _updateSaveBtn();
      return true;
    } catch(e) { return false; }
  }

  function _updateSaveBtn() {
    const btn = document.getElementById('study-save-btn');
    if (!btn) return;
    if (_isDirty) {
      btn.classList.add('dirty');
      btn.textContent = '💾 저장 *';
    } else {
      btn.classList.remove('dirty');
      btn.textContent = '💾 저장';
    }
  }

  async function _doSave(showToast = true) {
    if (!_isDirty || !GitHubModule.get().token || !currentFile) return;
    const btn = document.getElementById('study-save-btn');
    if (btn) { btn.textContent = '⏳ 저장 중…'; btn.disabled = true; }
    try {
      const { text, sha } = await GitHubModule.readFileWithSha(currentFile);
      const updated = updateAllCounts(text);
      if (updated === text) {
        _isDirty = false; localStorage.removeItem(SAVE_KEY); _updateSaveBtn();
        if (btn) btn.disabled = false;
        return;
      }
      const res = await GitHubModule.writeFile(currentFile, updated, '공부횟수 업데이트', sha);
      _lastSha = res?.newSha || res?.content?.sha || null;
      _isDirty = false; localStorage.removeItem(SAVE_KEY); _updateSaveBtn();
      if (showToast) AppToast.show('✓ GitHub 저장 완료', 'success');
    } catch(e) {
      _lastSha = null;
      if (btn) btn.classList.add('dirty');
      AppToast.show('저장 오류: ' + e.message, 'error');
    }
    if (btn) btn.disabled = false;
  }

  async function saveNow() { await _doSave(true); }

  async function trySaveGitHub() {
    _isDirty = true;
    _saveLocal();
    _updateSaveBtn();
  }

  function updateAllCounts(text) {
    const lines = text.split('\n');
    const result = [];
    let blockLines = [], blockIdx = 0;
    function flushBlock() {
      const word = allWords.find(w => w._idx === blockIdx);
      if (word !== undefined) {
        result.push(...blockLines.map(l =>
          /^\s*공부횟수\s*[：:]/.test(l)
            ? l.replace(/(\s*공부횟수\s*[：:]\s*)\d+/, `$1${word.studyCount || 0}`)
            : l
        ));
      } else {
        result.push(...blockLines);
      }
      blockLines = []; blockIdx++;
    }
    for (const line of lines) {
      if (/^\s*---\s*$/.test(line)) { flushBlock(); result.push(line); }
      else blockLines.push(line);
    }
    if (blockLines.length) flushBlock();
    return result.join('\n');
  }

  /* ── 노트 목록 ── */
  async function loadNotebooks() {
    const cfg = GitHubModule.get();
    if (!cfg.user || !cfg.repo) return;
    document.getElementById('st-repo-lbl').textContent = `${cfg.user}/${cfg.repo}`;
    document.getElementById('st-ftree').innerHTML =
      '<div style="padding:12px;font-size:12px;color:var(--sb-text2)">로딩 중…</div>';
    try {
      const tree = await GitHubModule.fetchTree();
      notebookFiles = tree.tree
        .filter(f => f.type === 'blob' && f.path.endsWith('.md'))
        .filter(f => !f.path.split('/').some(p => p.startsWith('.')))
        .filter(f => !cfg.bibleFolder || !f.path.startsWith(cfg.bibleFolder + '/'));
      if (cfg.wordsFolder) {
        const folder = cfg.wordsFolder.replace(/^\/+|\/+$/g,'').toLowerCase();
        notebookFiles = notebookFiles.filter(f => f.path.toLowerCase().startsWith(folder + '/'));
      }
      renderTree(notebookFiles.map(f => f.path));
      // 이전 파일 복원
      const last = localStorage.getItem('study_last_file');
      if (last && notebookFiles.find(f => f.path === last)) loadFile(last);
    } catch(e) {
      document.getElementById('st-ftree').innerHTML =
        `<div style="padding:12px;color:#e66;font-size:12px">${e.message}</div>`;
    }
  }

  function renderTree(paths) {
    const tree = {};
    paths.forEach(path => {
      const parts = path.split('/'); let node = tree;
      parts.forEach((p, i) => {
        if (i === parts.length - 1) (node.__f__ = node.__f__ || []).push({name:p, path});
        else { node[p] = node[p] || {}; node = node[p]; }
      });
    });
    document.getElementById('st-ftree').innerHTML = rNode(tree, 0);
  }

  function rNode(node, d) {
    let html = ''; const pad = 10 + d * 10;
    Object.keys(node).filter(k => k !== '__f__').sort().forEach(k => {
      html += `<div class="bk-tf" style="padding-left:${pad}px"
        onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="arr">▶</span>📁 ${k}</div><div class="bk-tc">${rNode(node[k], d+1)}</div>`;
    });
    (node.__f__ || []).sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
      const name = f.name.replace(/\.md$/, '');
      html += `<div class="bk-fi" style="padding-left:${pad+12}px" data-path="${f.path}"
        onclick="StudyModule.loadFile('${f.path}')" title="${f.path}">📝 ${name}</div>`;
    });
    return html;
  }

  function filterTree(q) {
    q = q.toLowerCase();
    const paths = notebookFiles.map(f => f.path);
    renderTree(q ? paths.filter(p => p.toLowerCase().includes(q)) : paths);
  }

  /* ── 파일 로드 ── */
  async function loadFile(path) {
    if (_isDirty && currentFile && currentFile !== path) await _doSave(false);
    currentFile = path;
    _lastSha = null;
    localStorage.setItem('study_last_file', path);

    // 사이드바 활성 표시
    document.querySelectorAll('#st-ftree .bk-fi').forEach(el =>
      el.classList.toggle('active', el.dataset.path === path)
    );
    const fname = path.split('/').pop().replace(/\.md$/, '');
    document.getElementById('st-title').innerHTML = `<strong>📝 ${fname}</strong>`;
    document.getElementById('st-reader').innerHTML =
      '<div class="s-status"><div class="s-loader"></div><h3>로딩 중…</h3></div>';

    try {
      const text = await GitHubModule.readFile(path);
      allWords = parseWords(text, path);
      const hadPending = _restoreLocal();
      renderWords();
      if (hadPending) AppToast.show('⚠ 미저장 공부횟수 복원됨', '');
      else AppToast.show(`${allWords.length}개 단어 로드`, 'success');
    } catch(e) {
      document.getElementById('st-reader').innerHTML =
        `<div class="s-status"><div class="s-icon">❌</div><h3>${e.message}</h3></div>`;
    }
  }

  // loadCurrentNotebook 호환성 유지
  function loadCurrentNotebook() { loadNotebooks(); }

  /* ── 파싱 ── */
  function parseWords(text, filePath) {
    const blocks = [];
    let cur = [];
    for (const line of text.split('\n')) {
      if (/^\s*---\s*$/.test(line)) { if (cur.length) blocks.push(cur.join('\n')); cur = []; }
      else cur.push(line);
    }
    if (cur.length) blocks.push(cur.join('\n'));

    return blocks.map((block, idx) => {
      const w = { _file: filePath, _idx: idx };
      block.split('\n').forEach(line => {
        const m = line.match(/^([^:：]+)[：:]\s*(.*)$/);
        if (!m) return;
        const k = m[1].trim();
        const v = m[2].trim()
          .replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1')
          .replace(/\*([^*]+)\*/g,'$1').replace(/_([^_]+)_/g,'$1');
        if (k==='라오')    w.lao = v;
        if (k==='발음')    w.pron = v;
        if (k==='한글')    w.kor = v;
        if (k==='영어')    w.eng = v;
        if (k==='반대말')  w.opp = v;
        if (k==='음성')    w.audio = v;
        if (k==='공부횟수') w.studyCount = Math.min(MAX_STUDY, parseInt(v)||0);
      });
      return (w.lao || w.kor || w.eng) ? w : null;
    }).filter(Boolean);
  }

  /* ── 렌더링 ── */
  function renderWords() {
    const area = document.getElementById('st-reader');
    if (!allWords.length) {
      area.innerHTML = '<div class="s-status"><div class="s-icon">📭</div><h3>단어가 없습니다</h3></div>';
      return;
    }
    area.innerHTML = allWords.map(w => cardHTML(w)).join('');
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function cardHTML(w) {
    const lk = `${w._file}::${w._idx}`;
    const lkS = lk.replace(/[^a-zA-Z0-9]/g,'_');
    const cnt = w.studyCount || 0;
    const laoHidden = colVis.lao ? '' : 'vis-hidden';
    const engHidden = colVis.eng ? '' : 'vis-hidden';
    const korHidden = colVis.kor ? '' : 'vis-hidden';

    return `
    <div class="sw-card" id="swc_${lkS}">
      <!-- 헤더: 라오어 + 음성버튼 -->
      <div class="sw-head">
        <div style="flex:1">
          <div class="sw-lao ${laoHidden}" onclick="StudyModule.toggleVal(this)"
            title="클릭: 가리기/보기">${esc(w.lao||'—')}</div>
          ${w.pron ? `<div class="sw-pron">${esc(w.pron)}</div>` : ''}
        </div>
        <button class="sw-audio-btn" ${!w.audio?'disabled':''}
          onclick="StudyModule.playAudio('${w.audio||''}')" title="라오어 발음 (mp3)">🔊</button>
      </div>

      <!-- 바디: 영어(TTS) + 한글 -->
      <div class="sw-body">
        ${w.eng ? `
        <div class="sw-row">
          <span class="sw-label">영어</span>
          <span class="sw-val eng ${engHidden}" onclick="StudyModule.toggleVal(this)"
            title="클릭: 가리기/보기">${esc(w.eng)}</span>
          <button class="sw-tts-btn" onclick="StudyModule.speakEng('${esc(w.eng)}',this)"
            title="영어 TTS">▶</button>
        </div>` : ''}
        ${w.kor ? `
        <div class="sw-row">
          <span class="sw-label">한글</span>
          <span class="sw-val ${korHidden}" onclick="StudyModule.toggleVal(this)"
            title="클릭: 가리기/보기">${esc(w.kor)}</span>
        </div>` : ''}
        ${w.opp ? `
        <div class="sw-row">
          <span class="sw-label" style="color:var(--ui-text3)">반댓말</span>
          <span class="sw-val" style="color:var(--ui-text3);font-size:calc(var(--study-fs) - 2px)">${esc(w.opp)}</span>
        </div>` : ''}
      </div>

      <!-- 푸터: 공부횟수 -->
      <div class="sw-foot">
        <span class="sw-count-label">공부횟수</span>
        <span class="sw-count-num" id="swn_${lkS}">${cnt}</span>
        <div class="sw-count-btns">
          <button class="sw-cbtn dec" onclick="StudyModule.changeCount('${lk}',-1)">－</button>
          <button class="sw-cbtn inc" onclick="StudyModule.changeCount('${lk}',1)">＋</button>
        </div>
      </div>
    </div>`;
  }

  /* ── 개별 셀 토글 ── */
  function toggleVal(el) {
    el.classList.toggle('vis-hidden');
  }

  /* ── 전체 열 토글 ── */
  function toggleCol(col) {
    colVis[col] = !colVis[col];
    document.getElementById('stog-' + col)?.classList.toggle('on', colVis[col]);
    // 전체 카드 적용
    const selector = col === 'lao' ? '.sw-lao' : col === 'eng' ? '.sw-val.eng' : '.sw-val:not(.eng)';
    document.querySelectorAll(`#st-reader ${selector}`).forEach(el => {
      el.classList.toggle('vis-hidden', !colVis[col]);
    });
  }

  /* ── 음성 ── */
  function getAudioUrl(filename) {
    const cfg = GitHubModule.get();
    return `https://raw.githubusercontent.com/${cfg.user}/${cfg.repo}/${cfg.branch||'main'}/audio/${filename}`;
  }

  function playAudio(filename) {
    if (!filename) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const a = new Audio(getAudioUrl(filename));
    currentAudio = a;
    a.play().catch(() => AppToast.show('음성 파일을 찾을 수 없습니다', 'error'));
  }

  /* ── 영어 TTS ── */
  let _ttsUtt = null;
  const _isAndroid = /android/i.test(navigator.userAgent);

  function speakEng(text, btn) {
    if (!window.speechSynthesis) return;
    if (_ttsUtt || window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      _ttsUtt = null;
      document.querySelectorAll('.sw-tts-btn').forEach(b => b.classList.remove('playing'));
      if (btn) return;
    }
    if (!text || !btn) return;
    btn.classList.add('playing');

    function speak(voice) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'en-US'; utt.rate = 0.88; utt.pitch = 1.0;
        if (voice) utt.voice = voice;
        utt.onend = utt.onerror = () => {
          _ttsUtt = null;
          if (btn) btn.classList.remove('playing');
        };
        _ttsUtt = utt;
        window.speechSynthesis.speak(utt);
      }, _isAndroid ? 200 : 50);
    }

    const voices = window.speechSynthesis.getVoices();
    const pick = list =>
      list.find(v => v.name === 'Daniel') ||
      list.find(v => /google uk english male/i.test(v.name)) ||
      list.find(v => /male/i.test(v.name) && v.lang.startsWith('en')) ||
      list.find(v => v.lang.startsWith('en')) || null;

    if (voices.length) speak(pick(voices));
    else {
      let done = false;
      window.speechSynthesis.onvoiceschanged = () => {
        if (done) return; done = true;
        speak(pick(window.speechSynthesis.getVoices()));
      };
      setTimeout(() => { if (!done) { done = true; speak(null); } }, 1000);
    }
  }

  /* ── 전체 재생 ── */
  function playAll() {
    let i = 0;
    function next() {
      if (i >= allWords.length) return;
      const w = allWords[i++];
      if (w.audio) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const a = new Audio(getAudioUrl(w.audio));
        currentAudio = a;
        a.onended = next;
        a.play().catch(next);
      } else { next(); }
    }
    next();
  }

  /* ── 공부횟수 ── */
  async function changeCount(lk, delta) {
    const [file, idxStr] = lk.split('::');
    const word = allWords.find(w => w._file === file && w._idx === parseInt(idxStr));
    if (!word) return;
    word.studyCount = Math.min(MAX_STUDY, Math.max(0, (word.studyCount||0) + delta));
    const lkS = lk.replace(/[^a-zA-Z0-9]/g, '_');
    const el = document.getElementById('swn_' + lkS);
    if (el) {
      el.textContent = word.studyCount;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 300);
    }
    await trySaveGitHub();
  }

  /* ── 사이드바 토글 ── */
  function toggleSidebar() {
    const sb  = document.getElementById('st-sidebar');
    const spl = document.getElementById('st-spl');
    const btn = document.getElementById('st-sb-btn');
    const open = sb.style.display !== 'none' && sb.offsetWidth > 0;
    sb.style.display  = open ? 'none' : 'flex';
    spl.style.display = open ? 'none' : 'block';
    btn?.classList.toggle('on', !open);
  }

  /* ── 설정 글자크기 ── */
  function setFontSize(sz) {
    const r = document.getElementById('st-reader');
    if (r) r.style.setProperty('--study-fs', sz + 'px');
    localStorage.setItem('study-fs', sz);
  }
  function restoreFontSize() {
    const sz = parseInt(localStorage.getItem('study-fs') || '19');
    const r = document.getElementById('st-reader');
    if (r) r.style.setProperty('--study-fs', sz + 'px');
  }

  function clearLocal() {
    try { localStorage.removeItem(SAVE_KEY); } catch(e) {}
    if (currentFile) loadFile(currentFile);
    AppToast.show('노트를 새로 불러왔습니다', '');
  }

  function init() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && _isDirty) _doSave(false);
    });
    window.addEventListener('beforeunload', () => {
      if (_isDirty) _doSave(false);
    });
    restoreFontSize();
  }

  return {
    init, loadNotebooks, loadFile, loadCurrentNotebook,
    filterTree, renderTree,
    toggleCol, toggleVal, toggleSidebar,
    playAudio, speakEng, playAll,
    changeCount, saveNow, clearLocal, setFontSize,
  };
})();
