/**
 * github.js — 공유 GitHub API 모듈
 * 책보기 / 단어공부 탭이 공통으로 사용
 */
const GitHubModule = (() => {

  let _cfg = {
    user: '', repo: '', branch: 'main', token: '',
    bibleFolder: 'Bible',
    hymnFolder: 'Hymn',
    ccmFolder: 'CCM',
  };

  const STORAGE_KEY = 'app_gh_cfg';

  /* ── 저장 / 로드 ── */
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cfg));
  }
  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) Object.assign(_cfg, JSON.parse(s));
    } catch(e) {}
    return _cfg;
  }
  function configure(opts) {
    Object.assign(_cfg, opts);
    save();
  }
  function get() { return { ..._cfg }; }
  function isReady() { return !!(get().user && get().repo); }

  /* ── HTTP ── */
  function headers() {
    const h = { 'Accept': 'application/vnd.github.v3+json' };
    if (_cfg.token) h['Authorization'] = 'token ' + _cfg.token;
    return h;
  }

  async function fetchContents(path) {
    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/contents/${path}?ref=${_cfg.branch}`;
    const r = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e.message || `HTTP ${r.status}`) + '\n경로: ' + path);
    }
    return r.json();
  }

  async function fetchTree() {
    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/git/trees/${_cfg.branch}?recursive=1`;
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  /* ── Git Blob 읽기 (1MB 초과 파일용) ──
     Contents API는 1MB 넘는 파일의 content를 안 돌려주므로,
     그 경우 blob sha로 Git Blob API를 다시 호출해서 받아온다. */
  async function fetchBlob(sha) {
    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/git/blobs/${sha}`;
    const r = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e.message || `HTTP ${r.status}`) + '\nblob sha: ' + sha);
    }
    return r.json();
  }

  /* ── Base64 디코드 (UTF-8 안전) ── */
  function decode64(b64) {
    const raw = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ── 파일 텍스트 읽기 ── */
  async function readFile(path) {
    const data = await fetchContents(path);
    if (Array.isArray(data)) throw new Error('폴더입니다(파일이 아님): ' + path);
    if (data.content) return decode64(data.content);
    // 1MB 초과 파일: Contents API가 content를 안 주므로 Git Blob API로 재시도
    if (data.sha) {
      const blob = await fetchBlob(data.sha);
      if (blob && blob.content) return decode64(blob.content);
    }
    throw new Error('파일 내용 없음: ' + path);
  }

  /* ── 파일 텍스트 + SHA 함께 읽기 ── */
  async function readFileWithSha(path) {
    const data = await fetchContents(path);
    if (Array.isArray(data)) throw new Error('폴더입니다(파일이 아님): ' + path);
    if (data.content) return { text: decode64(data.content), sha: data.sha };
    // 1MB 초과 파일: Contents API가 content를 안 주므로 Git Blob API로 재시도
    if (data.sha) {
      const blob = await fetchBlob(data.sha);
      if (blob && blob.content) return { text: decode64(blob.content), sha: data.sha };
    }
    throw new Error('파일 내용 없음: ' + path);
  }

  /* ── 파일 쓰기 ── */
  async function writeFile(path, text, message, sha) {
    if (!_cfg.token) throw new Error('GitHub 토큰이 필요합니다');
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const encoded = btoa(binary);
    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/contents/${path}`;

    let fileSha = sha;
    if (!fileSha) {
      try {
        const meta = await fetchContents(path);
        fileSha = meta.sha;
      } catch(e) {}
    }

    const body = { message: message || '앱에서 수정', content: encoded, branch: _cfg.branch };
    if (fileSha) body.sha = fileSha;

    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${r.status}`);
    }
    const result = await r.json();
    // PUT 응답에서 새 SHA 반환 → 다음 저장 시 재사용 가능
    return { ...result, newSha: result?.content?.sha };
  }

  return { save, load, configure, get, isReady, fetchContents, fetchTree, fetchBlob, readFile, readFileWithSha, writeFile, decode64 };
})();
