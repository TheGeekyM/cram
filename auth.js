// Sign in with Claude (same OAuth flow as Claude Code / aidle): PKCE, code pasted back from the browser.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE = 'https://claude.com/cai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';
exports.OAUTH_BETA = 'oauth-2025-04-20';

let dataDir, safeStorage, pending = null, cached = null;
exports.init = (dir, ss) => { dataDir = dir; safeStorage = ss; };
const file = () => path.join(dataDir, 'claude_token');
const enc = () => safeStorage?.isEncryptionAvailable(); // ponytail: plaintext .json fallback when no keyring (web mode)

function save(token) {
  cached = { ...token, savedAt: Date.now() };
  if (enc()) fs.writeFileSync(file() + '.enc', safeStorage.encryptString(JSON.stringify(cached)));
  else fs.writeFileSync(file() + '.json', JSON.stringify(cached));
}
function load() {
  if (cached) return cached;
  try {
    if (fs.existsSync(file() + '.enc') && enc()) cached = JSON.parse(safeStorage.decryptString(fs.readFileSync(file() + '.enc')));
    else if (fs.existsSync(file() + '.json')) cached = JSON.parse(fs.readFileSync(file() + '.json'));
  } catch (e) { console.error('[auth] load failed', e.message); }
  return cached;
}
exports.logout = () => { cached = null; for (const f of ['.enc', '.json']) fs.rmSync(file() + f, { force: true }); };
exports.signedIn = () => !!load()?.access_token;

exports.start = () => {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  pending = { verifier, state };
  return `${AUTHORIZE}?code=true&client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
};

const post = async body => { const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };

// pasted: "CODE#STATE" (as shown on the callback page), a bare code, or the full callback URL
exports.exchange = async pasted => {
  if (!pending) throw new Error('Click "Sign in with Claude" first.');
  const { verifier, state: expected } = pending; pending = null;
  let code = pasted.trim(), state = expected;
  try { const u = new URL(code); code = u.searchParams.get('code'); state = u.searchParams.get('state') || expected; }
  catch { if (code.includes('#')) [code, state] = code.split('#'); }
  const data = await post({ grant_type: 'authorization_code', code, state, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: verifier });
  if (data.error) throw new Error(data.error_description || data.error);
  save(data); return true;
};

// returns a valid access token, refreshing if within 60s of expiry; null if not signed in
exports.token = async () => {
  const t = load(); if (!t?.access_token) return null;
  if (Date.now() < t.savedAt + (t.expires_in || 3600) * 1000 - 60000) return t.access_token;
  const data = await post({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: CLIENT_ID });
  if (data.error) { console.error('[auth] refresh failed', data.error); return null; }
  save({ ...t, ...data }); return data.access_token;
};
