// Multiple profiles. A profile is a person and the role they are working towards, with its own
// studies, notes, review queue, plan board, blog, coach state and prep. One is active at a time;
// switching re-points the server's paths (server.js holds them in a mutable P) and the window reloads.
//
// Machine-level state stays in DATA and is shared by every profile: settings.json (keys, model,
// blogDaily), the auth tokens, reminders.json + app-alive (the cron job), csrun/ (the code sandbox).
const fs = require('fs');
const path = require('path');
const roles = require('./roles');

// Everything that belongs to one profile. Anything not listed here stays global in DATA.
const PER_PROFILE = ['studies', 'profile.json', 'notes.json', 'review.json', 'plan.json', 'blog.json', 'coach.json', 'reports.json', 'stories.json', 'prep.json'];
const INDEX = 'profiles.json';
const DEFAULT_ID = 'default';

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f); }; // atomic: remind.js may read any minute

const dirOf = (DATA, pid) => path.join(DATA, 'profiles', String(pid));
const indexPath = DATA => path.join(DATA, INDEX);
const readIndex = DATA => read(indexPath(DATA), null);
const activeId = DATA => readIndex(DATA)?.active || DEFAULT_ID;

// Move a flat, pre-profiles DATA into profiles/default. Runs on every boot and is idempotent.
// Renames only — never copies, never deletes — so a crash halfway leaves some names moved and the
// rest still at the root, and the next boot finishes the job. Old data is never destroyed.
function migrate(DATA) {
  const home = dirOf(DATA, DEFAULT_ID);
  fs.mkdirSync(home, { recursive: true });
  const moved = [];
  for (const name of PER_PROFILE) {
    const from = path.join(DATA, name), to = path.join(home, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) { fs.renameSync(from, to); moved.push(name); }
  }
  fs.mkdirSync(path.join(home, 'studies'), { recursive: true });
  if (!fs.existsSync(indexPath(DATA))) write(indexPath(DATA), { active: DEFAULT_ID }); // last: its absence is what marks "not migrated"
  if (moved.length) {
    try { fs.appendFileSync(path.join(DATA, 'migrated-profiles.txt'), `${new Date().toISOString()} moved into profiles/${DEFAULT_ID}: ${moved.join(', ')}\n`); } catch {}
    console.log(`         [profiles] moved into profiles/${DEFAULT_ID}: ${moved.join(', ')}`);
  }
  return moved;
}

// The picker's rows. `lastAt` is the newest thing in the profile, so the list sorts by recency.
function list(DATA) {
  const root = path.join(DATA, 'profiles');
  let ids = [];
  try { ids = fs.readdirSync(root).filter(id => { try { return fs.statSync(path.join(root, id)).isDirectory(); } catch { return false; } }); } catch {}
  return ids.map(id => {
    const p = read(path.join(dirOf(DATA, id), 'profile.json'), {}) || {};
    let studies = 0, lastAt = p.updatedAt || 0;
    try {
      for (const sid of fs.readdirSync(path.join(dirOf(DATA, id), 'studies'))) {
        if (sid === '_general') continue; // the hidden study behind the generic Interview/Code pages
        studies++;
        const s = read(path.join(dirOf(DATA, id), 'studies', sid, 'study.json'), null);
        if (s) lastAt = Math.max(lastAt, s.updatedAt || 0);
      }
    } catch {}
    return { id, name: p.name || 'Unnamed', target: p.target || '', career: p.career || '', roleTitle: p.role?.title || '', roleStatus: p.roleStatus || '', studies, lastAt };
  }).sort((a, b) => b.lastAt - a.lastAt);
}

// The one place a profile's fields are validated. server.js's POST /api/profile uses it too, so the
// onboarding form and later edits can never disagree about what is allowed.
const TEXT = ['name', 'career', 'goal', 'notes', 'examName', 'target', 'stage', 'language', 'country'];
function cleanProfile(body = {}, prev = {}) {
  const p = { ...prev, updatedAt: Date.now() };
  for (const k of TEXT) if (k in body) p[k] = String(body[k] ?? '').slice(0, 400);
  if ('hoursPerWeek' in body) p.hoursPerWeek = Math.max(1, Math.min(80, +body.hoursPerWeek || 5));
  if ('examDate' in body) p.examDate = /^\d{4}-\d{2}-\d{2}$/.test(body.examDate || '') ? body.examDate : '';
  return p;
}

function create(DATA, body) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  fs.mkdirSync(path.join(dirOf(DATA, id), 'studies'), { recursive: true });
  const profile = cleanProfile(body, {});
  write(path.join(dirOf(DATA, id), 'profile.json'), profile);
  return { id, profile };
}

const setActive = (DATA, pid) => {
  if (!fs.existsSync(dirOf(DATA, pid))) return false;
  write(indexPath(DATA), { ...(readIndex(DATA) || {}), active: String(pid) });
  return true;
};

// Deleting the active profile would leave the server pointing at a missing directory, so it is refused.
function remove(DATA, pid) {
  if (activeId(DATA) === String(pid)) return false;
  if (!fs.existsSync(dirOf(DATA, pid))) return false;
  fs.rmSync(dirOf(DATA, pid), { recursive: true, force: true });
  return true;
}

// Change only these fields, re-reading first: the derivation finishes minutes later, and the person
// may have edited their profile in the meantime.
const patch = (f, fields) => { const cur = read(f, {}) || {}; write(f, { ...cur, ...fields }); return { ...cur, ...fields }; };

// Has anything changed that would change the model's answer? Hours per week, a name or an exam date do
// not. Nor does anything at all when there is no target yet: there would be nothing to derive a role
// from, and a derivation costs a minute or two of model time.
const needsDerive = p => !!String(p?.target || '').trim() && roles.roleKey(p) !== p.roleKey;

// Fire and forget. The call takes 15-130s — far too long to hold up creating a profile — so the profile
// is marked pending, the request returns at once, and the answer lands whenever it lands. The directory
// is captured now, so switching profile mid-flight still writes the result into the right one.
function deriveRole(DATA, pid, ctx, force = false) {
  if (!ctx?.json) return; // no model available (no key, or a test mount): the static default covers it
  const f = path.join(dirOf(DATA, pid), 'profile.json');
  const p = read(f, {}) || {};
  // the one gate every caller goes through: no target to work from, or nothing has changed since the
  // last attempt, means no call. Callers can fire freely. `force` is the Retry button: a failed
  // derivation stores its key (so it cannot loop by itself), and this is the only way past that.
  if (!force && !needsDerive(p)) return;
  if (force && !String(p.target || '').trim()) return;
  patch(f, { roleStatus: 'pending', roleKey: roles.roleKey(p), roleError: '' });
  Promise.resolve()
    .then(() => roles.derive(ctx, p))
    .then(role => {
      const cur = read(f, {}) || {};
      patch(f, { role, roleStatus: 'ready', roleError: '', tools: cur.toolsEdited ? cur.tools : roles.toolsFor(role) });
      console.log(`         [roles] ${role.title || '(untitled)'} · code=${role.writesCode} · ${role.rounds.length} rounds`);
    })
    .catch(e => patch(f, { roleStatus: 'failed', roleError: String(e?.message || e).slice(0, 200) }));
}

// `activate` is server.js re-pointing its paths at the new profile; it is optional so this module
// can be mounted (and tested) on its own. `json`/`NO_STUDY` are optional too — without them a profile
// simply keeps the default toolset.
function routes(app, { DATA, activate, json, NO_STUDY }) {
  app.get('/api/profiles', (req, res) => res.json({ active: activeId(DATA), list: list(DATA) }));
  app.post('/api/profiles', (req, res) => {
    if (!String(req.body?.name || '').trim()) return res.status(400).json({ error: 'Give the profile a name.' });
    const { id, profile } = create(DATA, req.body);
    setActive(DATA, id); activate?.(id);
    res.json({ id, ...profile, roleStatus: 'pending' });
    deriveRole(DATA, id, { json, NO_STUDY }); // after the response: the app is usable while this runs
  });
  // Retry after a failed derivation, or re-tailor on demand. The only way past the stored key.
  app.post('/api/profile/role', (req, res) => {
    const pid = activeId(DATA);
    deriveRole(DATA, pid, { json, NO_STUDY }, true);
    res.json({ ok: true, roleStatus: 'pending' });
  });
  app.post('/api/profiles/:pid/activate', (req, res) => {
    if (!setActive(DATA, req.params.pid)) return res.status(404).json({ error: 'no such profile' });
    activate?.(req.params.pid);
    res.json({ ok: true, active: req.params.pid });
  });
  app.delete('/api/profiles/:pid', (req, res) => {
    if (!fs.existsSync(dirOf(DATA, req.params.pid))) return res.status(404).json({ error: 'no such profile' });
    if (!remove(DATA, req.params.pid)) return res.status(400).json({ error: 'That profile is open. Switch to another one first.' });
    res.json({ ok: true });
  });
}

module.exports = { PER_PROFILE, DEFAULT_ID, migrate, list, dirOf, activeId, cleanProfile, create, setActive, remove, routes, deriveRole, needsDerive };
