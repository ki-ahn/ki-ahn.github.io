/**
 * bibleview.js — "성경" 탭 전용 모듈
 * ================================
 * 책보기 안에서 인용되는 성경구절 처리(bible.js/BibleModule)와는 별개로,
 * "성경" 탭에서 직접 검색해서 보는 기능을 담당한다.
 *
 * 입력창에 넣을 수 있는 것:
 *   (창 1)   또는  창 1      → 성경 본문 (설정에서 켠 버전들을 병렬로 표시)
 *   123                     → 찬송가 이미지 (hymnFolder 안에서 번호로 찾음)
 *   거룩                     → CCM 이미지 (ccmFolder 안에서 제목 부분일치로 찾음)
 *
 * 찬송가/CCM 검색 결과가 여러 개면 왼쪽 "검색 결과" 목록에 표시되고,
 * 하나를 클릭하면 오른쪽에 이미지가 뜬다 (이미지는 클릭해서 확대/축소 가능).
 *
 * 아래를 그대로 재사용한다:
 *   - BibleModule.BOOK_MAP / parseRef / tts   (bible.js)
 *   - GitHubModule.fetchContents / fetchBlob / readFile  (github.js)
 *   - bible.js의 injectStyles()가 이미 넣어둔 .bible-content 등 CSS
 */
const BibleViewModule = (() => {

  let _cfg = {
    bibleFolder: 'Bible',
    hymnFolder: 'Bible/Hymn',
    ccmFolder: 'Bible/CCM',
    enabledVersions: ['개역개정', 'ESV'],
  };

  let _hymnList = null; // [{name, path}] 캐시 (폴더 목록)
  let _ccmList  = null;

  function configure(opts) {
    if (!opts) return;
    if (opts.hymnFolder !== undefined && opts.hymnFolder !== _cfg.hymnFolder) _hymnList = null;
    if (opts.ccmFolder  !== undefined && opts.ccmFolder  !== _cfg.ccmFolder)  _ccmList  = null;
    Object.assign(_cfg, opts);
  }

  /* ── 유틸 ── */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _stripExt(name) { return name.replace(/\.[^.]+$/, ''); }
  function _mimeFor(path) {
    const ext = path.split('.').pop().toLowerCase();
    return { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml' }[ext] || 'application/octet-stream';
  }
  function _setTitle(text) {
    const el = document.getElementById('bible-topbar-title');
    if (el) el.textContent = text || '';
  }

  /* ── 이미지 파일을 GitHub에서 받아와 Blob URL로 변환 (1MB 초과 대응 포함) ── */
  async function _fetchImageBlobUrl(path) {
    const meta = await GitHubModule.fetchContents(path);
    if (Array.isArray(meta)) throw new Error('폴더입니다(파일 아님): ' + path);
    let b64 = meta.content;
    if (!b64 && meta.sha) {
      const blob = await GitHubModule.fetchBlob(meta.sha);
      b64 = blob && blob.content;
    }
    if (!b64) throw new Error('이미지 내용을 불러올 수 없습니다: ' + path);
    b64 = b64.replace(/\n/g, '');
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: _mimeFor(path) });
    return URL.createObjectURL(blob);
  }

  /* ── 폴더 안의 이미지 파일 목록 (캐시) ── */
  async function _listImageFolder(folder) {
    if (!folder) return [];
    try {
      const list = await GitHubModule.fetchContents(folder);
      if (!Array.isArray(list)) return [];
      return list.filter(it => it.type === 'file' && /\.(jpe?g|png|gif|webp|svg)$/i.test(it.name));
    } catch(e) { return []; }
  }

  /* ══════════════════════════════════════
     왼쪽 "검색 결과" 목록 (찬송가/CCM 다중매칭용)
  ══════════════════════════════════════ */
  function _clearResultList() {
    const label = document.getElementById('bible-toc-label');
    const toc = document.getElementById('bible-toc');
    if (label) label.textContent = '검색 결과';
    if (toc) toc.innerHTML = '<div class="bible-toc-empty">찬송가·CCM 검색 결과가<br>여러 개면 여기 표시됩니다</div>';
  }

  function _renderResultList(title, items, onPick) {
    const label = document.getElementById('bible-toc-label');
    const toc = document.getElementById('bible-toc');
    if (!toc) return;
    if (label) label.textContent = `${title} (${items.length})`;
    toc.innerHTML = items.map((it, i) => `<div class="bk-fi" data-idx="${i}">${esc(_stripExt(it.name))}</div>`).join('');
    toc.querySelectorAll('.bk-fi').forEach((el, i) => {
      el.onclick = () => {
        toc.querySelectorAll('.bk-fi').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        onPick(items[i]);
      };
    });
  }

  /* ══════════════════════════════════════
     검색 라우팅
  ══════════════════════════════════════ */
  function search(raw) {
    const input = document.getElementById('bible-input');
    const q = (raw !== undefined ? raw : (input ? input.value : '')).trim();
    if (!q) return;
    if (input) input.value = q;

    // 이전 검색에서 이미지를 확대(zoom)한 채로 새 검색을 하면
    // 그 이미지 DOM은 사라지지만 body에 걸어둔 overflow:hidden은 안 풀리므로 여기서 초기화
    document.body.style.overflow = '';

    // "검색" 버튼을 클릭하면 브라우저가 포커스를 버튼으로 옮기므로,
    // 검색을 넘긴 직후(다음 틱) 다시 입력란으로 포커스를 되돌려서
    // 바로 이어서 타이핑할 수 있게 한다.
    if (input) setTimeout(() => input.focus(), 0);

    // 1) 성경구절: (창 1) 또는 창 1  (괄호는 있어도 없어도 인식)
    const parsed = BibleModule.parseRef(q);
    if (parsed && BibleModule.BOOK_MAP[parsed.book]) {
      _clearResultList();
      _showBibleRef(parsed);
      return;
    }
    // 2) 순수 숫자 → 찬송가
    if (/^\d+$/.test(q)) {
      _showHymn(q);
      return;
    }
    // 3) 그 외 → CCM 제목 검색
    _showCcm(q);
  }

  /* ── 성경 본문 (선택된 버전 병렬) ── */
  async function _loadChapter(version, bookKey) {
    const info = BibleModule.BOOK_MAP[bookKey];
    const path = `${_cfg.bibleFolder}/${version}/${info.num}_${info.file}.json`;
    const text = await GitHubModule.readFile(path);
    return JSON.parse(text);
  }
  function _extractVerses(bookData, chapter, verses) {
    const ch = bookData[chapter] || bookData[String(parseInt(chapter))];
    if (!ch) return [];
    const result = [];
    if (!verses) {
      Object.keys(ch).filter(k => /^[Vv]\d+$/.test(k))
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
    return verseGroups.map((group, idx) => {
      const sep = idx === 0 ? '' : '<hr class="bible-group-hr">';
      return sep + _verseHtml(_extractVerses(bookData, chapter, group));
    }).join('');
  }

  async function _showBibleRef(parsed) {
    const main = document.getElementById('bible-main');
    if (!main) return;
    const info = BibleModule.BOOK_MAP[parsed.book];
    main.innerHTML = '<div class="bible-loading">📖 불러오는 중…</div>';

    const versions = _cfg.enabledVersions.length ? _cfg.enabledVersions : ['개역개정'];
    const results = await Promise.allSettled(
      versions.map(v => _loadChapter(v, parsed.book).then(data => ({ v, data })))
    );

    let refLabel = `${info.full} ${parsed.chapter}장`;
    if (parsed.verseGroups) {
      refLabel += ' ' + parsed.verseGroups
        .map(g => g.length === 1 ? `${g[0]}절` : `${g[0]}~${g[g.length-1]}절`)
        .join(', ');
    }
    _setTitle('📖 ' + refLabel);

    let html = `<div class="bible-view-hd">📖 ${esc(refLabel)}</div><div class="bible-view-body">`;
    results.forEach((r, i) => {
      const v = versions[i];
      if (r.status === 'fulfilled') {
        const ttsBtn = `<button class="bible-tts-btn" onclick="BibleModule.tts(this)" title="읽기">▶ 듣기</button>`;
        html += `<div class="bible-all-block">` +
                `<div class="bible-ver-label">${esc(v)}</div>` +
                `<div class="bible-content" data-version="${esc(v)}">${_groupsHtml(parsed.verseGroups, r.value.data, parsed.chapter)}${ttsBtn}</div>` +
                `</div>`;
      } else {
        html += `<div class="bible-all-block"><div class="bible-ver-label">${esc(v)}</div><div class="bible-error">⚠ ${esc(r.reason?.message || '불러오기 실패')}</div></div>`;
      }
    });
    html += '</div>';
    main.innerHTML = html;
  }

  /* ── 이미지(찬송가/CCM) 공통 렌더링 — 클릭으로 확대/축소 ── */
  async function _renderImage(icon, label, file) {
    const main = document.getElementById('bible-main');
    main.innerHTML = '<div class="bible-loading">불러오는 중…</div>';
    try {
      const url = await _fetchImageBlobUrl(file.path);
      _setTitle(`${icon} ${label}`);
      main.innerHTML =
        `<div class="bible-view-hd">${icon} ${esc(label)}</div>` +
        `<div class="bible-img-wrap">` +
        `<div class="bible-img-backdrop" onclick="BibleViewModule.unzoomImage()"></div>` +
        `<img src="${url}" alt="${esc(label)}" onclick="BibleViewModule.toggleZoom(this)" title="클릭: 확대 / 다시 클릭: 원래대로">` +
        `</div>`;
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  function toggleZoom(img) {
    const backdrop = img.parentElement.querySelector('.bible-img-backdrop');
    const zoomed = img.classList.toggle('zoomed');
    if (backdrop) backdrop.classList.toggle('show', zoomed);
    document.body.style.overflow = zoomed ? 'hidden' : '';
  }
  function unzoomImage() {
    const img = document.querySelector('.bible-img-wrap img.zoomed');
    if (img) toggleZoom(img);
  }

  /* ── 찬송가 (번호로 이미지 찾기, 여러 개 걸리면 목록에서 고르게) ── */
  async function _showHymn(num) {
    const main = document.getElementById('bible-main');
    if (!main) return;
    main.innerHTML = '<div class="bible-loading">🎵 찬송가 찾는 중…</div>';
    try {
      if (!_hymnList) _hymnList = await _listImageFolder(_cfg.hymnFolder);
      if (!_hymnList.length) {
        _clearResultList();
        main.innerHTML = `<div class="bible-error">⚠ 찬송가 폴더(${esc(_cfg.hymnFolder)})에서 이미지를 찾지 못했습니다.<br>설정 → GitHub에서 폴더 경로를 확인해주세요.</div>`;
        return;
      }
      const target = String(parseInt(num, 10));
      let matches = _hymnList.filter(f => _stripExt(f.name) === target);
      if (!matches.length) matches = _hymnList.filter(f => new RegExp(`(^|\\D)0*${target}(\\D|$)`).test(_stripExt(f.name)));
      if (!matches.length) {
        _clearResultList();
        main.innerHTML = `<div class="bible-error">⚠ ${esc(target)}장 찬송가를 찾지 못했습니다.</div>`;
        return;
      }
      if (matches.length === 1) {
        _clearResultList();
        await _renderImage('🎵', `찬송가 ${target}장`, matches[0]);
      } else {
        _renderResultList(`🎵 찬송가 ${target}장`, matches, (f) => _renderImage('🎵', _stripExt(f.name), f));
        main.innerHTML = '<div class="bible-empty">왼쪽 검색 결과에서 하나를 선택하세요</div>';
        _setTitle(`🎵 찬송가 ${target}장 (${matches.length}개)`);
      }
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  /* ── CCM (제목 부분일치로 이미지 찾기, 여러 개 걸리면 목록에서 고르게) ── */
  async function _showCcm(query) {
    const main = document.getElementById('bible-main');
    if (!main) return;
    main.innerHTML = '<div class="bible-loading">🎤 CCM 찾는 중…</div>';
    try {
      if (!_ccmList) _ccmList = await _listImageFolder(_cfg.ccmFolder);
      if (!_ccmList.length) {
        _clearResultList();
        main.innerHTML = `<div class="bible-error">⚠ CCM 폴더(${esc(_cfg.ccmFolder)})에서 이미지를 찾지 못했습니다.<br>설정 → GitHub에서 폴더 경로를 확인해주세요.</div>`;
        return;
      }
      const q = query.toLowerCase();
      const matches = _ccmList.filter(f => _stripExt(f.name).toLowerCase().includes(q));
      if (!matches.length) {
        _clearResultList();
        main.innerHTML = `<div class="bible-error">⚠ "${esc(query)}"와 일치하는 CCM을 찾지 못했습니다.</div>`;
        return;
      }
      if (matches.length === 1) {
        _clearResultList();
        await _renderImage('🎤', _stripExt(matches[0].name), matches[0]);
      } else {
        _renderResultList(`🎤 "${query}"`, matches, (f) => _renderImage('🎤', _stripExt(f.name), f));
        main.innerHTML = '<div class="bible-empty">왼쪽 검색 결과에서 하나를 선택하세요</div>';
        _setTitle(`🎤 "${query}" 검색 결과 (${matches.length}개)`);
      }
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  /* ══════════════════════════════════════
     초기화 (입력창/버튼 바인딩)
  ══════════════════════════════════════ */
  function init() {
    const input = document.getElementById('bible-input');
    const btn   = document.getElementById('bible-search-btn');
    if (btn)   btn.addEventListener('click', () => search());
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    _clearResultList();

    // 안전장치: 성경 탭이 화면에 떠 있는 동안 포커스가 어디에도 없이(body로) 빠지면
    // 자동으로 다시 입력란에 포커스를 준다. (결과를 보다가 다시 검색하려 할 때
    // 포커스가 안 잡히던 문제 대비 — 원인이 무엇이든 이걸로 항상 복구됨)
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const panel = document.getElementById('panel-bible');
        if (!panel || !panel.classList.contains('on')) return;
        if (document.activeElement === document.body) {
          document.getElementById('bible-input')?.focus();
        }
      }, 40);
    });
  }

  return { configure, init, search, toggleZoom, unzoomImage };
})();

window.BibleViewModule = BibleViewModule;
