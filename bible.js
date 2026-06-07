/**
 * bible.js — 성경 모듈 v3
 * ========================
 * 저장소 구조: {bibleFolder}/{version}/{num}_{EnglishName}.json
 *   예) Blog/Bible/ESV/01_Genesis.json
 *       Blog/Bible/개역개정/43_John.json
 *
 * JSON 구조 (책 파일):
 *   { "1": { "V1": "...", "V2": "..." }, "2": { ... } }
 *
 * 지원 참조 구문 (반드시 괄호로 감쌀 것):
 *   (창 1)              → 창세기 1장 전체
 *   (창 1:3)            → 1장 3절
 *   (창 1:3-5)          → 3~5절  ← - 사용
 *   (창 1:3~5)          → 3~5절  ← ~ 사용 (마크다운 전에 보호됨)
 *   (창 1:1, 5-7, 11-13) → 복합 범위
 *
 * 핵심: protectRefs() / restoreRefs() 로 마크다운 렌더링 전/후 처리
 *   1) protectRefs(md)  → ~ 를 - 로 정규화 + 플레이스홀더로 보호
 *   2) marked.parse()
 *   3) restoreRefs(html) → 플레이스홀더를 bible-ref span 으로 복원
 *   4) processDom(el)    → 클릭 이벤트 연결
 */

const BibleModule = (() => {

  /* ── 지원 버전 ── */
  const VERSIONS = ['개역개정', '새번역', 'ESV', 'NIV', 'LAO', 'Henry', 'Hokma'];

  /* ── 책 매핑 ── */
  const BOOK_MAP = {
    '창':  { num:'01', file:'Genesis',         full:'창세기' },
    '창세기':{ num:'01', file:'Genesis',        full:'창세기' },
    '출':  { num:'02', file:'Exodus',          full:'출애굽기' },
    '출애굽기':{ num:'02', file:'Exodus',       full:'출애굽기' },
    '레':  { num:'03', file:'Leviticus',       full:'레위기' },
    '레위기':{ num:'03', file:'Leviticus',      full:'레위기' },
    '민':  { num:'04', file:'Numbers',         full:'민수기' },
    '민수기':{ num:'04', file:'Numbers',        full:'민수기' },
    '신':  { num:'05', file:'Deuteronomy',     full:'신명기' },
    '신명기':{ num:'05', file:'Deuteronomy',    full:'신명기' },
    '수':  { num:'06', file:'Joshua',          full:'여호수아' },
    '여호수아':{ num:'06', file:'Joshua',       full:'여호수아' },
    '삿':  { num:'07', file:'Judges',          full:'사사기' },
    '사사기':{ num:'07', file:'Judges',         full:'사사기' },
    '룻':  { num:'08', file:'Ruth',            full:'룻기' },
    '룻기':{ num:'08', file:'Ruth',             full:'룻기' },
    '삼상':{ num:'09', file:'1_Samuel',         full:'사무엘상' },
    '사무엘상':{ num:'09', file:'1_Samuel',      full:'사무엘상' },
    '삼하':{ num:'10', file:'2_Samuel',         full:'사무엘하' },
    '사무엘하':{ num:'10', file:'2_Samuel',      full:'사무엘하' },
    '왕상':{ num:'11', file:'1_Kings',          full:'열왕기상' },
    '열왕기상':{ num:'11', file:'1_Kings',       full:'열왕기상' },
    '왕하':{ num:'12', file:'2_Kings',          full:'열왕기하' },
    '열왕기하':{ num:'12', file:'2_Kings',       full:'열왕기하' },
    '대상':{ num:'13', file:'1_Chronicles',     full:'역대상' },
    '역대상':{ num:'13', file:'1_Chronicles',    full:'역대상' },
    '대하':{ num:'14', file:'2_Chronicles',     full:'역대하' },
    '역대하':{ num:'14', file:'2_Chronicles',    full:'역대하' },
    '스':  { num:'15', file:'Ezra',            full:'에스라' },
    '에스라':{ num:'15', file:'Ezra',           full:'에스라' },
    '느':  { num:'16', file:'Nehemiah',        full:'느헤미야' },
    '느헤미야':{ num:'16', file:'Nehemiah',     full:'느헤미야' },
    '에':  { num:'17', file:'Esther',          full:'에스더' },
    '에스더':{ num:'17', file:'Esther',         full:'에스더' },
    '욥':  { num:'18', file:'Job',             full:'욥기' },
    '욥기':{ num:'18', file:'Job',              full:'욥기' },
    '시':  { num:'19', file:'Psalms',          full:'시편' },
    '시편':{ num:'19', file:'Psalms',           full:'시편' },
    '잠':  { num:'20', file:'Proverbs',        full:'잠언' },
    '잠언':{ num:'20', file:'Proverbs',         full:'잠언' },
    '전':  { num:'21', file:'Ecclesiastes',    full:'전도서' },
    '전도서':{ num:'21', file:'Ecclesiastes',   full:'전도서' },
    '아':  { num:'22', file:'Song_of_Songs',   full:'아가' },
    '아가':{ num:'22', file:'Song_of_Songs',    full:'아가' },
    '사':  { num:'23', file:'Isaiah',          full:'이사야' },
    '이사야':{ num:'23', file:'Isaiah',         full:'이사야' },
    '렘':  { num:'24', file:'Jeremiah',        full:'예레미야' },
    '예레미야':{ num:'24', file:'Jeremiah',     full:'예레미야' },
    '애':  { num:'25', file:'Lamentations',    full:'예레미야애가' },
    '예레미야애가':{ num:'25', file:'Lamentations', full:'예레미야애가' },
    '겔':  { num:'26', file:'Ezekiel',         full:'에스겔' },
    '에스겔':{ num:'26', file:'Ezekiel',        full:'에스겔' },
    '단':  { num:'27', file:'Daniel',          full:'다니엘' },
    '다니엘':{ num:'27', file:'Daniel',         full:'다니엘' },
    '호':  { num:'28', file:'Hosea',           full:'호세아' },
    '호세아':{ num:'28', file:'Hosea',          full:'호세아' },
    '욜':  { num:'29', file:'Joel',            full:'요엘' },
    '요엘':{ num:'29', file:'Joel',             full:'요엘' },
    '암':  { num:'30', file:'Amos',            full:'아모스' },
    '아모스':{ num:'30', file:'Amos',           full:'아모스' },
    '옵':  { num:'31', file:'Obadiah',         full:'오바댜' },
    '오바댜':{ num:'31', file:'Obadiah',        full:'오바댜' },
    '욘':  { num:'32', file:'Jonah',           full:'요나' },
    '요나':{ num:'32', file:'Jonah',            full:'요나' },
    '미':  { num:'33', file:'Micah',           full:'미가' },
    '미가':{ num:'33', file:'Micah',            full:'미가' },
    '나':  { num:'34', file:'Nahum',           full:'나훔' },
    '나훔':{ num:'34', file:'Nahum',            full:'나훔' },
    '합':  { num:'35', file:'Habakkuk',        full:'하박국' },
    '하박국':{ num:'35', file:'Habakkuk',       full:'하박국' },
    '습':  { num:'36', file:'Zephaniah',       full:'스바냐' },
    '스바냐':{ num:'36', file:'Zephaniah',      full:'스바냐' },
    '학':  { num:'37', file:'Haggai',          full:'학개' },
    '학개':{ num:'37', file:'Haggai',           full:'학개' },
    '슥':  { num:'38', file:'Zechariah',       full:'스가랴' },
    '스가랴':{ num:'38', file:'Zechariah',      full:'스가랴' },
    '말':  { num:'39', file:'Malachi',         full:'말라기' },
    '말라기':{ num:'39', file:'Malachi',        full:'말라기' },
    '마':  { num:'40', file:'Matthew',         full:'마태복음' },
    '마태복음':{ num:'40', file:'Matthew',      full:'마태복음' },
    '막':  { num:'41', file:'Mark',            full:'마가복음' },
    '마가복음':{ num:'41', file:'Mark',         full:'마가복음' },
    '눅':  { num:'42', file:'Luke',            full:'누가복음' },
    '누가복음':{ num:'42', file:'Luke',         full:'누가복음' },
    '요':  { num:'43', file:'John',            full:'요한복음' },
    '요한복음':{ num:'43', file:'John',         full:'요한복음' },
    '행':  { num:'44', file:'Acts',            full:'사도행전' },
    '사도행전':{ num:'44', file:'Acts',         full:'사도행전' },
    '롬':  { num:'45', file:'Romans',          full:'로마서' },
    '로마서':{ num:'45', file:'Romans',         full:'로마서' },
    '고전':{ num:'46', file:'1_Corinthians',    full:'고린도전서' },
    '고린도전서':{ num:'46', file:'1_Corinthians', full:'고린도전서' },
    '고후':{ num:'47', file:'2_Corinthians',    full:'고린도후서' },
    '고린도후서':{ num:'47', file:'2_Corinthians', full:'고린도후서' },
    '갈':  { num:'48', file:'Galatians',       full:'갈라디아서' },
    '갈라디아서':{ num:'48', file:'Galatians',  full:'갈라디아서' },
    '엡':  { num:'49', file:'Ephesians',       full:'에베소서' },
    '에베소서':{ num:'49', file:'Ephesians',    full:'에베소서' },
    '빌':  { num:'50', file:'Philippians',     full:'빌립보서' },
    '빌립보서':{ num:'50', file:'Philippians',  full:'빌립보서' },
    '골':  { num:'51', file:'Colossians',      full:'골로새서' },
    '골로새서':{ num:'51', file:'Colossians',   full:'골로새서' },
    '살전':{ num:'52', file:'1_Thessalonians',  full:'데살로니가전서' },
    '데살로니가전서':{ num:'52', file:'1_Thessalonians', full:'데살로니가전서' },
    '살후':{ num:'53', file:'2_Thessalonians',  full:'데살로니가후서' },
    '데살로니가후서':{ num:'53', file:'2_Thessalonians', full:'데살로니가후서' },
    '딤전':{ num:'54', file:'1_Timothy',        full:'디모데전서' },
    '디모데전서':{ num:'54', file:'1_Timothy',   full:'디모데전서' },
    '딤후':{ num:'55', file:'2_Timothy',        full:'디모데후서' },
    '디모데후서':{ num:'55', file:'2_Timothy',   full:'디모데후서' },
    '딛':  { num:'56', file:'Titus',           full:'디도서' },
    '디도서':{ num:'56', file:'Titus',          full:'디도서' },
    '몬':  { num:'57', file:'Philemon',        full:'빌레몬서' },
    '빌레몬서':{ num:'57', file:'Philemon',     full:'빌레몬서' },
    '히':  { num:'58', file:'Hebrews',         full:'히브리서' },
    '히브리서':{ num:'58', file:'Hebrews',      full:'히브리서' },
    '약':  { num:'59', file:'James',           full:'야고보서' },
    '야고보서':{ num:'59', file:'James',        full:'야고보서' },
    '벧전':{ num:'60', file:'1_Peter',          full:'베드로전서' },
    '베드로전서':{ num:'60', file:'1_Peter',     full:'베드로전서' },
    '벧후':{ num:'61', file:'2_Peter',          full:'베드로후서' },
    '베드로후서':{ num:'61', file:'2_Peter',     full:'베드로후서' },
    '요일':{ num:'62', file:'1_John',           full:'요한일서' },
    '요한일서':{ num:'62', file:'1_John',        full:'요한일서' },
    '요이':{ num:'63', file:'2_John',           full:'요한이서' },
    '요한이서':{ num:'63', file:'2_John',        full:'요한이서' },
    '요삼':{ num:'64', file:'3_John',           full:'요한삼서' },
    '요한삼서':{ num:'64', file:'3_John',        full:'요한삼서' },
    '유':  { num:'65', file:'Jude',            full:'유다서' },
    '유다서':{ num:'65', file:'Jude',           full:'유다서' },
    '계':  { num:'66', file:'Revelation',      full:'요한계시록' },
    '요한계시록':{ num:'66', file:'Revelation',  full:'요한계시록' },
  };

  /* ── 캐시 & 설정 ── */
  const _cache = {};
  let _cfg = {
    user: '', repo: '', branch: 'main', token: '',
    bibleFolder: 'Bible',
    enabledVersions: ['개역개정', 'ESV'],
  };

  function configure(cfg) {
    Object.assign(_cfg, cfg);
    if (_cfg.bibleFolder) _cfg.bibleFolder = _cfg.bibleFolder.replace(/^\/+|\/+$/g, '');
  }

  /* ══════════════════════════════════════════
     정규식: 책이름 목록 (긴 것 먼저)
  ══════════════════════════════════════════ */
  function _bookPattern() {
    return Object.keys(BOOK_MAP)
      .sort((a, b) => b.length - a.length)
      .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
  }

  /* ══════════════════════════════════════════
     ★ 핵심: 마크다운 전처리 보호
     marked 가 (갈 1:3~5) 의 ~ 를 취소선으로 바꾸기 전에
     성경 참조 전체를 HTML 인코딩된 플레이스홀더로 치환
  ══════════════════════════════════════════ */
  const _placeholders = {};   // id → 정규화된 참조 문자열

  // marked 가 절대 건드리지 않는 플레이스홀더 형식:
  // 영숫자만으로 구성된 인라인 코드 ` 로 감싸기
  // → marked 는 코드 span 내부를 그대로 통과시킴
  // 복원 시 <code>BREF_xxxx</code> 를 찾아 span 으로 교체
  const _BREF_PREFIX = 'BIBLEREF0';

  function protectRefs(md) {
    Object.keys(_placeholders).forEach(k => delete _placeholders[k]);

    const bp = _bookPattern();
    const re = new RegExp(
      `(\\((?:${bp})\\s+\\d+(?::[\\d,\\s\\-~]+)?\\))`,
      'g'
    );

    return md.replace(re, (match) => {
      const normalized = match.replace(/~/g, '-');
      // 충돌 없는 짧은 숫자 id
      const id = _BREF_PREFIX + (Object.keys(_placeholders).length).toString().padStart(4,'0');
      _placeholders[id] = normalized;
      // 인라인 코드로 감싸면 marked 가 내부를 변환하지 않음
      return '`' + id + '`';
    });
  }

  function restoreRefs(html) {
    // <code>BIBLEREF0xxxx</code> → bible-ref span
    return html.replace(/<code>(BIBLEREF0\d{4})<\/code>/g, (_, id) => {
      const ref = _placeholders[id];
      if (!ref) return '';
      const escaped = ref.replace(/"/g, '&quot;');
      return `<span class="bible-ref" data-ref="${escaped}" role="button" tabindex="0">${ref}</span>`;
    });
  }

  /* ══════════════════════════════════════════
     참조 파싱
  ══════════════════════════════════════════ */
  // "1, 5-7, 11-13" → [[1],[5,6,7],[11,12,13]]
  function _parseVerseSpec(spec) {
    if (!spec || !spec.trim()) return null;
    const groups = [];
    for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);   // ~ 는 이미 - 로 정규화됨
      if (m) {
        const arr = [];
        for (let i = parseInt(m[1]); i <= parseInt(m[2]); i++) arr.push(i);
        groups.push(arr);
      } else if (/^\d+$/.test(part)) {
        groups.push([parseInt(part)]);
      }
    }
    return groups.length ? groups : null;
  }

  function parseRef(refStr) {
    // ~ 를 - 로 정규화 후 파싱
    const s = refStr.replace(/~/g, '-').replace(/[()]/g, '').trim();
    const bp = _bookPattern();
    const m = s.match(new RegExp(`^(${bp})\\s+(\\d+)(?::([\\d,\\s\\-]+))?$`));
    if (!m) return null;
    return { book: m[1], chapter: m[2], verseGroups: _parseVerseSpec(m[3]), raw: refStr };
  }

  /* ══════════════════════════════════════════
     GitHub API
  ══════════════════════════════════════════ */
  async function _ghFetch(repoPath) {
    if (!_cfg.user || !_cfg.repo) throw new Error('저장소 정보가 설정되지 않았습니다.');
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (_cfg.token) headers['Authorization'] = 'token ' + _cfg.token;
    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/contents/${repoPath}?ref=${_cfg.branch}`;
    console.log('[Bible] GET', url);
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const msg = err.message || `HTTP ${r.status}`;
      console.error('[Bible] 오류:', msg, url);
      throw new Error(msg + '\n호출: ' + url);
    }
    return r.json();
  }

  function _decode(b64) {
    const raw = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ══════════════════════════════════════════
     책 파일 로드 & 캐시
  ══════════════════════════════════════════ */
  async function _loadBook(version, bookKey) {
    const info = BOOK_MAP[bookKey];
    if (!info) throw new Error(`알 수 없는 책: "${bookKey}"`);
    const cacheKey = `${_cfg.bibleFolder}|${version}|${info.num}_${info.file}`;
    if (_cache[cacheKey] !== undefined) {
      if (_cache[cacheKey] === null)
        throw new Error(`성경 파일 없음\n저장소: ${_cfg.user}/${_cfg.repo}\n경로: ${_cfg.bibleFolder}/${version}/${info.num}_${info.file}.json`);
      return _cache[cacheKey];
    }
    const filePath = `${_cfg.bibleFolder}/${version}/${info.num}_${info.file}.json`;
    try {
      const data = await _ghFetch(filePath);
      const json = JSON.parse(_decode(data.content));
      _cache[cacheKey] = json;
      return json;
    } catch (e) {
      _cache[cacheKey] = null;
      throw new Error(`파일 없음\n저장소: ${_cfg.user}/${_cfg.repo}\n경로: ${filePath}\n오류: ${e.message}`);
    }
  }

  /* ══════════════════════════════════════════
     절 추출 & HTML 렌더링
  ══════════════════════════════════════════ */
  function _extractVerses(bookData, chapter, verses) {
    const ch = bookData[chapter] || bookData[String(parseInt(chapter))];
    if (!ch) return [];
    const result = [];
    if (!verses) {
      Object.keys(ch)
        .filter(k => /^[Vv]\d+$/.test(k))
        .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
        .forEach(k => result.push({ num: parseInt(k.slice(1)), text: ch[k] }));
    } else {
      for (const n of verses) {
        const t = ch['V'+n] || ch['v'+n] || ch[String(n)];
        if (t) result.push({ num: n, text: t });
      }
    }
    return result;
  }

  function _verseHtml(verses) {
    if (!verses.length) return `<span class="bible-no-verse">해당 절을 찾을 수 없습니다</span>`;
    return verses.map(v =>
      `<span class="bible-verse-line"><sup class="bible-verse-num">${v.num}</sup><span class="bible-verse-txt">${v.text}</span></span>`
    ).join(' ');
  }

  function _groupsHtml(verseGroups, bookData, chapter) {
    if (!verseGroups) return _verseHtml(_extractVerses(bookData, chapter, null));
    // 복합 범위: 그룹 사이를 얇은 가로줄로만 구분, 레이블 없음
    return verseGroups.map((group, idx) => {
      const sep = idx === 0 ? '' : '<hr class="bible-group-hr">';
      return sep + _verseHtml(_extractVerses(bookData, chapter, group));
    }).join('');
  }

  /* ══════════════════════════════════════════
     콜아웃 생성
     ★ 버전이 여럿이면 "전체 보기" 버튼 제공
        → 모든 버전을 세로로 한꺼번에 표시
  ══════════════════════════════════════════ */
  function _createCallout(parsed, anchorEl) {
    const info = BOOK_MAP[parsed.book];
    const fullBook = info ? info.full : parsed.book;
    let refLabel = `${fullBook} ${parsed.chapter}장`;
    if (parsed.verseGroups) {
      refLabel += ' ' + parsed.verseGroups
        .map(g => g.length === 1 ? `${g[0]}절` : `${g[0]}~${g[g.length-1]}절`)
        .join(', ');
    } else {
      refLabel += ' 전체';
    }

    const hasMultiple = _cfg.enabledVersions.length > 1;

    // 탭 목록 + "전체 보기" 버튼
    const tabs = _cfg.enabledVersions.map((v, i) =>
      `<button class="bv-tab${i === 0 ? ' active' : ''}" data-ver="${v}">${v}</button>`
    ).join('');
    const allBtn = hasMultiple
      ? `<button class="bv-tab bv-all-btn" data-ver="__all__" title="선택된 모든 버전 보기">전체 보기</button>`
      : '';

    const callout = document.createElement('div');
    callout.className = 'bible-callout';
    callout.innerHTML = `
      <div class="bible-callout-hd">
        <span class="bible-callout-icon">✝</span>
        <span class="bible-callout-ref">${refLabel}</span>
        <button class="bible-callout-close" title="닫기">✕</button>
      </div>
      <div class="bible-version-tabs">${tabs}${allBtn}</div>
      <div class="bible-callout-body"><div class="bible-loading">불러오는 중…</div></div>`;

    callout.querySelector('.bible-callout-close').onclick = e => {
      e.stopPropagation(); callout.remove();
    };

    callout.querySelectorAll('.bv-tab').forEach(tab => {
      tab.onclick = () => {
        callout.querySelectorAll('.bv-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const ver = tab.dataset.ver;
        if (ver === '__all__') {
          _loadAllVersions(callout.querySelector('.bible-callout-body'), parsed);
        } else {
          _loadOne(callout.querySelector('.bible-callout-body'), parsed, ver);
        }
      };
    });

    anchorEl.after(callout);
    // 첫 버전 로드
    if (_cfg.enabledVersions.length > 0) {
      _loadOne(callout.querySelector('.bible-callout-body'), parsed, _cfg.enabledVersions[0]);
    }
    return callout;
  }

  // 단일 버전 로드
  async function _loadOne(bodyEl, parsed, version) {
    bodyEl.innerHTML = '<div class="bible-loading">📖 불러오는 중…</div>';
    try {
      const bookData = await _loadBook(version, parsed.book);
      const ttsBtn = `<button class="bible-tts-btn" onclick="BibleModule.tts(this)" title="읽기">▶ 듣기</button>`;
      bodyEl.innerHTML =
        `<div class="bible-content" data-version="${version}">${_groupsHtml(parsed.verseGroups, bookData, parsed.chapter)}${ttsBtn}</div>`;
    } catch (e) {
      bodyEl.innerHTML = `<div class="bible-error">⚠ ${e.message}</div>`;
    }
  }

  // ★ 전체 버전 동시 로드
  async function _loadAllVersions(bodyEl, parsed) {
    bodyEl.innerHTML = '<div class="bible-loading">📖 모든 버전 불러오는 중…</div>';
    const results = await Promise.allSettled(
      _cfg.enabledVersions.map(v => _loadBook(v, parsed.book).then(data => ({ v, data })))
    );
    let html = '';
    results.forEach((r, i) => {
      const v = _cfg.enabledVersions[i];
      if (r.status === 'fulfilled') {
        const { data } = r.value;
        const ttsBtn = `<button class="bible-tts-btn" onclick="BibleModule.tts(this)" title="읽기">▶ 듣기</button>`;
        html +=
          `<div class="bible-all-block">` +
          `<div class="bible-content" data-version="${v}">${_groupsHtml(parsed.verseGroups, data, parsed.chapter)}${ttsBtn}</div>` +
          `</div>`;
      } else {
        const msg = r.reason?.message || '불러오기 실패';
        html += `<div class="bible-all-block"><div class="bible-error">⚠ ${msg}</div></div>`;
      }
    });
    bodyEl.innerHTML = html || '<div class="bible-no-verse">결과 없음</div>';
  }

  /* ══════════════════════════════════════════
     processDom: DOM 안의 bible-ref span 에 클릭 이벤트 연결
     (restoreRefs 로 이미 span 이 삽입된 상태)
  ══════════════════════════════════════════ */
  function processDom(rootEl) {
    if (!rootEl.dataset.bibleAttached) {
      rootEl.dataset.bibleAttached = '1';
      rootEl.addEventListener('click', _onClick);
      rootEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') _onClick(e);
      });
    }
  }

  function _onClick(e) {
    const span = e.target.closest('.bible-ref');
    if (!span) return;
    e.preventDefault();
    const next = span.nextElementSibling;
    if (next && next.classList.contains('bible-callout')) { next.remove(); return; }
    const parsed = parseRef(span.dataset.ref);
    if (parsed && BOOK_MAP[parsed.book]) _createCallout(parsed, span);
  }

  /* ══════════════════════════════════════════
     CSS 주입
  ══════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('bible-styles')) return;
    const s = document.createElement('style');
    s.id = 'bible-styles';
    s.textContent = `
      .bible-ref {
        color: var(--accent2, #8b6914);
        cursor: pointer;
        border-bottom: 1.5px dotted var(--accent, #c4a45a);
        padding: 0 1px;
        border-radius: 2px;
        transition: background .15s;
      }
      .bible-ref:hover { background: rgba(196,164,90,.18); border-bottom-style: solid; }

      .bible-callout {
        margin: .75em 0;
        border: 1px solid #d4b870;
        border-left: 4px solid var(--accent, #c4a45a);
        border-radius: 6px;
        background: #fdf8ec;
        font-size: .91em;
        overflow: hidden;
      }
      /* 다크모드: data-dark 속성 방식 (index.html 기준) */
      [data-dark] .bible-callout,
      [data-theme="dark"] .bible-callout {
        background: #1e1a10;
        border-color: #4a3808;
        border-left-color: #c4a45a;
      }
      [data-dark] .bible-callout-ref,
      [data-theme="dark"] .bible-callout-ref {
        color: #e8dcc8 !important;
      }
      [data-dark] .bible-callout-icon,
      [data-theme="dark"] .bible-callout-icon {
        color: #c4a45a !important;
      }
      .bible-callout-hd {
        display: flex; align-items: center; gap: 7px;
        padding: 8px 13px;
        background: rgba(196,164,90,.09);
        border-bottom: 1px solid rgba(196,164,90,.22);
      }
      .bible-callout-icon { font-size: 12px; color: var(--accent2, #8b6914); }
      .bible-callout-ref  { flex: 1; font-family: var(--font-ui, sans-serif); font-size: 12px; font-weight: 700; color: var(--text, #2c2416); }
      .bible-callout-close { background: none; border: none; cursor: pointer; color: var(--text-muted, #8a7a5a); font-size: 14px; padding: 0 2px; border-radius: 3px; }
      .bible-callout-close:hover { color: #d44; }

      .bible-version-tabs {
        display: flex; flex-wrap: wrap; gap: 5px;
        padding: 7px 13px;
        border-bottom: 1px solid rgba(196,164,90,.18);
      }
      .bv-tab {
        background: rgba(196,164,90,.1);
        border: 1px solid var(--accent, #c4a45a);
        color: var(--accent2, #8b6914);
        border-radius: 4px; padding: 2px 9px;
        font-size: 11px; font-weight: 600; cursor: pointer;
        font-family: var(--font-ui, sans-serif);
        transition: all .15s; line-height: 1.6;
      }
      .bv-tab:hover  { background: rgba(196,164,90,.28); }
      .bv-tab.active { background: var(--accent, #c4a45a); color: #fff; border-color: var(--accent2, #8b6914); }
      /* 전체 보기 버튼 — 구분감 있게 */
      .bv-all-btn {
        margin-left: 4px;
        background: rgba(100,160,255,.12) !important;
        border-color: #6090cc !important;
        color: #3060aa !important;
      }
      .bv-all-btn:hover  { background: rgba(100,160,255,.28) !important; }
      .bv-all-btn.active { background: #5080cc !important; color: #fff !important; border-color: #3060aa !important; }
      [data-theme="dark"] .bv-all-btn,
      [data-dark] .bv-all-btn { color: #88aaee !important; border-color: #4466aa !important; }
      [data-theme="dark"] .bv-all-btn.active,
      [data-dark] .bv-all-btn.active { background: #3355aa !important; }

      /* ── 다크모드 본문 텍스트 (data-dark 방식) ── */
      [data-dark] .bible-content,
      [data-theme="dark"] .bible-content { color: #e8dcc8 !important; }
      [data-dark] .bible-verse-num,
      [data-theme="dark"] .bible-verse-num { color: #c4a45a !important; }
      [data-dark] .bible-ver-label,
      [data-theme="dark"] .bible-ver-label { color: #c4a45a !important; }
      [data-dark] .bible-loading,
      [data-dark] .bible-no-verse,
      [data-theme="dark"] .bible-loading,
      [data-theme="dark"] .bible-no-verse { color: #8a7a5a !important; }
      [data-dark] .bible-callout-body,
      [data-theme="dark"] .bible-callout-body { color: #e8dcc8; }
      [data-dark] .bible-callout-hd,
      [data-theme="dark"] .bible-callout-hd {
        background: rgba(196,164,90,.12);
        border-bottom-color: rgba(196,164,90,.25);
      }
      [data-dark] .bible-version-tabs,
      [data-theme="dark"] .bible-version-tabs { border-bottom-color: rgba(196,164,90,.2); }
      /* 버전 탭 — 라이트모드 */
      .bv-tab { color: #5a3c08; }
      .bv-tab.active { background: var(--accent, #c4a45a); color: #fff !important; border-color: var(--accent2, #8b6914); }
      /* 다크모드 버전 탭 */
      [data-dark] .bv-tab,
      [data-theme="dark"] .bv-tab { color: #c4a45a; background: rgba(196,164,90,.08); }
      [data-dark] .bv-tab.active,
      [data-theme="dark"] .bv-tab.active { background: #c4a45a !important; color: #111 !important; border-color: #a08030 !important; }
      [data-dark] .bible-all-block,
      [data-theme="dark"] .bible-all-block { border-bottom-color: rgba(196,164,90,.18); }

      .bible-callout-body { padding: 11px 15px 13px; }

      /* 버전 레이블 */
      .bible-ver-label {
        font-family: var(--font-ui, sans-serif);
        font-size: 10px; font-weight: 700;
        color: var(--accent2, #8b6914);
        text-transform: uppercase; letter-spacing: .6px;
        margin-bottom: 5px;
      }

      /* 전체 보기: 버전 블록 구분 */
      .bible-all-block {
        padding: 10px 0;
        border-bottom: 1px solid rgba(196,164,90,.2);
      }
      .bible-all-block:last-child { border-bottom: none; padding-bottom: 0; }
      .bible-all-block:first-child { padding-top: 0; }

      .bible-content {
        font-family: var(--font-body, Georgia, serif);
        font-style: italic; line-height: 1.9;
        color: var(--text, #2c2416);
      }
      .bible-verse-line { display: inline; }
      .bible-verse-num  {
        font-size: 9px; font-weight: 700;
        color: var(--accent2, #8b6914);
        vertical-align: super; margin-right: 2px;
        font-style: normal; font-family: var(--font-ui, sans-serif);
      }
      .bible-verse-txt  { display: inline; }

      .bible-group-hr {
        border: none;
        border-top: 1px solid rgba(196,164,90,.3);
        margin: 8px 0;
      }

      .bible-loading  { color: var(--text-muted, #8a7a5a); font-size: 13px; font-style: normal; font-family: var(--font-ui, sans-serif); }
      .bible-no-verse { color: var(--text-muted, #8a7a5a); font-size: 12px; font-style: normal; }
      .bible-error    {
        color: #b33; font-size: 12px; font-style: normal;
        font-family: var(--font-ui, sans-serif); line-height: 1.7;
        white-space: pre-line; background: rgba(200,0,0,.06);
        border-radius: 4px; padding: 8px 10px;
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════
     TTS — 성경 읽기
     안드로이드: 절 단위 큐 방식 (끊김 방지)
     데스크탑/iOS: 단일 utterance
  ══════════════════════════════════════════ */
  const _isAndroid = /android/i.test(navigator.userAgent);
  const _isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);

  let _ttsBtn    = null;
  let _ttsActive = false;
  let _ttsQueue  = [];
  let _ttsTimer  = null;
  let _ttsUtt    = null;

  function _resetBtn() {
    _ttsActive = false;
    _ttsQueue  = [];
    _ttsUtt    = null;
    if (_ttsTimer) { clearTimeout(_ttsTimer); _ttsTimer = null; }
    document.querySelectorAll('.bible-tts-btn')
      .forEach(b => { b.textContent = '▶ 듣기'; b.classList.remove('playing'); });
    _ttsBtn = null;
  }

  // 텍스트 → 짧은 청크 배열 (안드로이드 끊김 방지)
  function _toChunks(text, maxLen) {
    const parts = text.split(/(?<=[.!?。,，])\s*/g).filter(s => s.trim());
    const chunks = [];
    let cur = '';
    for (const p of parts) {
      if (cur.length + p.length > maxLen && cur) {
        chunks.push(cur.trim());
        cur = p;
      } else {
        cur += (cur ? ' ' : '') + p;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [text];
  }

  // 안드로이드: 큐에서 하나씩 재생 (청크 간 150ms 간격)
  function _playQueue(voice, lang, rate) {
    if (!_ttsActive || _ttsQueue.length === 0) {
      if (_ttsActive) _resetBtn();
      return;
    }
    const chunk = _ttsQueue.shift();
    window.speechSynthesis.cancel();
    _ttsTimer = setTimeout(() => {
      if (!_ttsActive) return;
      const utt = new SpeechSynthesisUtterance(chunk);
      utt.lang  = lang;
      utt.rate  = rate;
      utt.pitch = 1.0;
      if (voice) utt.voice = voice;
      utt.onend = () => { if (_ttsActive) _playQueue(voice, lang, rate); };
      utt.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        _resetBtn();
      };
      _ttsUtt = utt;
      window.speechSynthesis.speak(utt);
    }, 150);
  }

  // 목소리 선택
  function _pickVoice(voices, lang) {
    if (lang.startsWith('ko')) {
      return voices.find(v => v.lang.startsWith('ko') && /male|남|man/i.test(v.name))
          || voices.find(v => v.lang === 'ko-KR')
          || voices.find(v => v.lang.startsWith('ko'))
          || null;
    }
    if (lang.startsWith('en')) {
      return voices.find(v => v.name === 'Daniel')
          || voices.find(v => /google uk english male/i.test(v.name))
          || voices.find(v => /male/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find(v => v.lang === 'en-GB')
          || voices.find(v => v.lang.startsWith('en'))
          || null;
    }
    return null;
  }

  function tts(btn) {
    if (!window.speechSynthesis) {
      if (window.AppToast) AppToast.show('TTS를 지원하지 않는 브라우저입니다.', 'error');
      return;
    }
    // 재생 중 → 정지
    if (_ttsActive) {
      window.speechSynthesis.cancel();
      _resetBtn();
      return;
    }
    const content = btn.closest('.bible-content');
    if (!content) return;
    const verses = [];
    content.querySelectorAll('.bible-verse-txt').forEach(el => {
      const t = el.textContent.trim();
      if (t) verses.push(t);
    });
    if (!verses.length) return;

    const ver = content.dataset.version || '';
    const isEngVer = ['ESV','NIV','Henry','KJV','NASB','LAO'].some(v => ver.includes(v));
    const lang = isEngVer ? 'en-US' : 'ko-KR';

    _ttsBtn = btn;
    _ttsActive = true;
    btn.textContent = '■ 정지';
    btn.classList.add('playing');

    function start(voice) {
      window.speechSynthesis.cancel();

      if (_isAndroid) {
        // ── 안드로이드: 절(verse) 단위로 큐 구성 ──
        // 안드로이드 Web Speech는 utterance 하나당 ~15초 이상이면 끊김
        // → 절 하나씩(짧게) + cancel→setTimeout→speak 패턴으로 우회
        _ttsQueue = [...verses];  // 절 단위 그대로 (청크 추가 분할 없음)

        function nextVerse() {
          if (!_ttsActive || _ttsQueue.length === 0) {
            if (_ttsActive) _resetBtn();
            return;
          }
          const verseText = _ttsQueue.shift();
          // cancel → 충분한 딜레이 → speak
          window.speechSynthesis.cancel();
          _ttsTimer = setTimeout(() => {
            if (!_ttsActive) return;
            const utt = new SpeechSynthesisUtterance(verseText);
            utt.lang  = lang;
            utt.rate  = 1.0;   // 안드로이드: 1.0이 가장 안정적
            utt.pitch = 1.0;
            utt.volume = 1.0;
            if (voice) utt.voice = voice;
            utt.onend = () => {
              // onend 후 바로 speak하면 안드로이드가 씹음 → 200ms 후 다음 절
              _ttsTimer = setTimeout(nextVerse, 200);
            };
            utt.onerror = (e) => {
              if (e.error === 'interrupted' || e.error === 'canceled') {
                // cancel로 인한 것이면 무시 (이미 _resetBtn 호출됨)
                return;
              }
              // 실제 오류면 다음 절로 넘어가기 (한 절 건너뛰기)
              _ttsTimer = setTimeout(nextVerse, 300);
            };
            _ttsUtt = utt;
            window.speechSynthesis.speak(utt);
          }, 200);  // cancel 후 250ms 대기 — 안드로이드 정리 시간
        }

        // 첫 절 시작 전 500ms 대기 (초기 voices 로드 완료 보장)
        _ttsTimer = setTimeout(nextVerse, 500);

      } else {
        // ── 데스크탑/iOS: 전체 텍스트 단일 utterance ──
        const fullText = verses.join(' ');
        const utt = new SpeechSynthesisUtterance(fullText);
        utt.lang  = lang;
        utt.rate  = 0.88;
        utt.pitch = 1.0;
        if (voice) utt.voice = voice;
        utt.onend   = _resetBtn;
        utt.onerror = (e) => { if (e.error !== 'interrupted') _resetBtn(); };
        _ttsUtt = utt;
        // 데스크탑 크롬 keepAlive
        if (!_isIOS) {
          const ka = setInterval(() => {
            if (!_ttsActive) { clearInterval(ka); return; }
            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          }, 12000);
        }
        window.speechSynthesis.speak(utt);
      }
    }

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      start(_pickVoice(voices, lang));
    } else {
      let done = false;
      window.speechSynthesis.onvoiceschanged = () => {
        if (done) return; done = true;
        window.speechSynthesis.onvoiceschanged = null;
        start(_pickVoice(window.speechSynthesis.getVoices(), lang));
      };
      setTimeout(() => {
        if (!done) { done = true; start(_pickVoice(window.speechSynthesis.getVoices(), lang)); }
      }, 1200);
    }
  }

  /* ══════════════════════════════════════════
     Public API
  ══════════════════════════════════════════ */
  return {
    VERSIONS,
    BOOK_MAP,
    configure,
    injectStyles,
    protectRefs,
    restoreRefs,
    processDom,
    parseRef,
    tts,
  };

})();
