/**
 * github.js — 공유 GitHub API 모듈
 * 책보기 / 단어공부 탭이 공통으로 사용
 */
const GitHubModule = (() => {

  let _cfg = {
    user: '', repo: '', branch: 'main', token: '',
    wordsFolder: '',   // 단어장 폴더
    bibleFolder: 'Bible',
    rootFolder: '',    // 책보기 루트
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
    const r = await fetch(url, { headers: headers() });
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
    if (!data.content) throw new Error('파일 내용 없음: ' + path);
    return decode64(data.content);
  }

  /* ── 파일 쓰기 (토큰 필요) ── */
  async function writeFile(path, text, message) {
    if (!_cfg.token) throw new Error('GitHub 토큰이 필요합니다');
    // 현재 SHA 가져오기
    const meta = await fetchContents(path);
    const sha = meta.sha;
    // UTF-8 → base64 인코딩
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const encoded = btoa(binary);

    const url = `https://api.github.com/repos/${_cfg.user}/${_cfg.repo}/contents/${path}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || '앱에서 수정',
        content: encoded,
        sha: sha,
        branch: _cfg.branch,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  return { save, load, configure, get, isReady, fetchContents, fetchTree, readFile, writeFile, decode64 };
})();
