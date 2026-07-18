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
     목차(66권) 리스트
  ══════════════════════════════════════ */
  function _bookList() {
    const seen = new Set();
    const arr = [];
    Object.entries(BibleModule.BOOK_MAP).forEach(([key, info]) => {
      if (seen.has(info.num)) return;
      seen.add(info.num);
      arr.push({ short: key, full: info.full, num: info.num });
    });
    arr.sort((a, b) => a.num.localeCompare(b.num));
    return arr;
  }

  function _renderToc() {
    const el = document.getElementById('bible-toc');
    if (!el) return;
    const books = _bookList();
    const ot = books.filter(b => parseInt(b.num) <= 39);
    const nt = books.filter(b => parseInt(b.num) > 39);
    const row = b => `<div class="bk-fi" onclick="BibleViewModule.pickBook('${b.short}')">${esc(b.full)}</div>`;
    el.innerHTML =
      `<div class="bk-tf open" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')"><span class="arr">▶</span>구약 (${ot.length})</div>` +
      `<div class="bk-tc open">${ot.map(row).join('')}</div>` +
      `<div class="bk-tf open" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')"><span class="arr">▶</span>신약 (${nt.length})</div>` +
      `<div class="bk-tc open">${nt.map(row).join('')}</div>`;
  }

  function pickBook(short) {
    search(`(${short} 1)`);
  }

  /* ══════════════════════════════════════
     검색 라우팅
  ══════════════════════════════════════ */
  function search(raw) {
    const input = document.getElementById('bible-input');
    const q = (raw !== undefined ? raw : (input ? input.value : '')).trim();
    if (!q) return;
    if (input) input.value = q;

    // 1) 성경구절: (창 1) 또는 창 1  (괄호는 있어도 없어도 인식)
    const parsed = BibleModule.parseRef(q);
    if (parsed && BibleModule.BOOK_MAP[parsed.book]) {
      AppToast.show('parsed');
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
      `<span class="bible-verse-line"><sup class="bible-verse-num">${v.num}</sup><span class="bible-verse-txt">${esc(v.text)}</span></span>`
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

  /* ── 찬송가 (번호로 이미지 찾기) ── */
  async function _showHymn(num) {
    const main = document.getElementById('bible-main');
    if (!main) return;
    main.innerHTML = '<div class="bible-loading">🎵 찬송가 찾는 중…</div>';
    try {
      if (!_hymnList) _hymnList = await _listImageFolder(_cfg.hymnFolder);
      if (!_hymnList.length) {
        main.innerHTML = `<div class="bible-error">⚠ 찬송가 폴더(${esc(_cfg.hymnFolder)})에서 이미지를 찾지 못했습니다.<br>설정 → 읽기 설정에서 폴더 경로를 확인해주세요.</div>`;
        return;
      }
      const target = String(parseInt(num, 10));
      let match = _hymnList.find(f => _stripExt(f.name) === target);
      if (!match) match = _hymnList.find(f => new RegExp(`(^|\\D)0*${target}(\\D|$)`).test(_stripExt(f.name)));
      if (!match) {
        main.innerHTML = `<div class="bible-error">⚠ ${esc(target)}장 찬송가를 찾지 못했습니다.</div>`;
        return;
      }
      const url = await _fetchImageBlobUrl(match.path);
      main.innerHTML = `<div class="bible-view-hd">🎵 찬송가 ${esc(target)}장</div><div class="bible-img-wrap"><img src="${url}" alt="찬송가 ${esc(target)}장"></div>`;
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  /* ── CCM (제목 부분일치로 이미지 찾기) ── */
  async function _showCcm(query) {
    const main = document.getElementById('bible-main');
    if (!main) return;
    main.innerHTML = '<div class="bible-loading">🎤 CCM 찾는 중…</div>';
    try {
      if (!_ccmList) _ccmList = await _listImageFolder(_cfg.ccmFolder);
      if (!_ccmList.length) {
        main.innerHTML = `<div class="bible-error">⚠ CCM 폴더(${esc(_cfg.ccmFolder)})에서 이미지를 찾지 못했습니다.<br>설정 → 읽기 설정에서 폴더 경로를 확인해주세요.</div>`;
        return;
      }
      const q = query.toLowerCase();
      const matches = _ccmList.filter(f => _stripExt(f.name).toLowerCase().includes(q));
      if (!matches.length) {
        main.innerHTML = `<div class="bible-error">⚠ "${esc(query)}"와 일치하는 CCM을 찾지 못했습니다.</div>`;
        return;
      }
      if (matches.length === 1) {
        await _renderCcmImage(matches[0]);
      } else {
        main.innerHTML = `<div class="bible-view-hd">🎤 "${esc(query)}" 검색 결과 (${matches.length}개)</div>` +
          `<div class="bible-ccm-list">${matches.map((f, i) => `<button class="bible-ccm-item" data-idx="${i}">${esc(_stripExt(f.name))}</button>`).join('')}</div>`;
        main.querySelectorAll('.bible-ccm-item').forEach((btn, i) => {
          btn.onclick = () => _renderCcmImage(matches[i]);
        });
      }
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  async function _renderCcmImage(file) {
    const main = document.getElementById('bible-main');
    main.innerHTML = '<div class="bible-loading">🎤 불러오는 중…</div>';
    try {
      const url = await _fetchImageBlobUrl(file.path);
      main.innerHTML = `<div class="bible-view-hd">🎤 ${esc(_stripExt(file.name))}</div><div class="bible-img-wrap"><img src="${url}" alt="${esc(file.name)}"></div>`;
    } catch(e) {
      main.innerHTML = `<div class="bible-error">⚠ ${esc(e.message)}</div>`;
    }
  }

  /* ══════════════════════════════════════
     초기화 (입력창/버튼 바인딩 + 목차 렌더)
  ══════════════════════════════════════ */
  function init() {
    const input = document.getElementById('bible-input');
    const btn   = document.getElementById('bible-search-btn');
    if (btn)   btn.addEventListener('click', () => search());
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    _renderToc();
  }

  return { configure, init, search, pickBook };
})();
