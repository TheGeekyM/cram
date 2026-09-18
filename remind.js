// Offline study reminder, run hourly by cron (switched on from Settings). Sends at most one desktop
// notification a day, after the chosen hour, when nothing was studied in the last 20 hours.
// Usage: remind.js <data dir> [--hour 19] [--dry-run]     daily nudge
//        remind.js <data dir> --custom [--dry-run]         reminders at your own times
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// Studies, the profile and the review queue moved into profiles/<active>/ — this job runs while Cram is
// closed, so it resolves the active profile itself. Falls back to the flat root for a pre-profiles data dir.
const profileDir = data => { const id = read(path.join(data, 'profiles.json'))?.active; return id ? path.join(data, 'profiles', id) : data; };
function lastActivity(data) {
  const dir = path.join(profileDir(data), 'studies'); let last = 0;
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const s = read(path.join(dir, id, 'study.json')); if (!s) continue;
    last = Math.max(last, s.updatedAt || 0, ...(s.quizzes || []).map(q => q.at || 0), ...(s.challenges || []).map(c => c.at || 0),
      ...(s.interviews || []).flatMap(i => [i.at || 0, ...(i.turns || []).map(t => t.at || 0)]));
  }
  for (const c of read(path.join(profileDir(data), 'review.json'))?.cards || []) last = Math.max(last, c.lastAt || 0);
  return last;
}
const shouldNotify = ({ now, last, hour, notifiedDay }) => { const d = new Date(now); return d.getHours() >= hour && notifiedDay !== d.toDateString() && now - last > 20 * 36e5; };
// Custom reminders (Settings → reminders at your own times), run every minute by cron while any are on.
// Quiet while the app is running (its heartbeat is under a minute old): the app shows those alerts itself.
async function custom(data, dry, now = new Date()) {
  const { due, dayKey } = await import('./src/reminders.mjs');
  const file = path.join(data, 'reminders.json'), d = read(file);
  if (!d?.list?.length || d.whenClosed === false) { if (dry) console.log('no custom reminders'); return []; }
  if (now.getTime() - (+read(path.join(data, 'app-alive')) || 0) < 60e3) { if (dry) console.log('app is running, it shows alerts itself'); return []; }
  const hits = d.list.filter(r => due(r, now, d.fired || {}));
  if (!hits.length) { if (dry) console.log('no custom reminder due'); return []; }
  for (const r of hits) {
    if (dry) { console.log('would notify:', r.label, r.time); continue; }
    await new Promise(done => execFile('notify-send', ['--app-name=Cram', '--urgency=critical', r.label || 'Time to study', `Cram reminder · ${r.time}`], () => done()));
  }
  if (dry) return hits;
  const fresh = read(file) || d, day = dayKey(now), ids = new Set(hits.map(r => r.id)); // re-read: the app may have saved meanwhile
  fresh.fired = { ...(fresh.fired || {}) }; for (const id of ids) fresh.fired[id] = day;
  fresh.list = (fresh.list || []).map(r => ids.has(r.id) ? { ...r, snoozeUntil: null } : r);
  fs.writeFileSync(file + '.tmp', JSON.stringify(fresh)); fs.renameSync(file + '.tmp', file);
  return hits;
}
module.exports = { shouldNotify, lastActivity, custom };

if (require.main === module) {
  const argv = process.argv.slice(2), data = argv[0], hour = +(argv.join(' ').match(/--hour (\d+)/)?.[1] ?? 19), dry = argv.includes('--dry-run');
  if (!data || !fs.existsSync(data)) { console.error('usage: remind.js <data dir> [--hour 19] [--dry-run]'); process.exit(2); }
  if (argv.includes('--custom')) return void custom(data, dry).catch(e => { console.error(e.message); process.exit(1); });
  const stateFile = path.join(data, 'remind-state.json'), state = read(stateFile) || {}, now = Date.now(), last = lastActivity(data);
  if (!shouldNotify({ now, last, hour, notifiedDay: state.day })) { if (dry) console.log('no reminder due'); process.exit(0); }
  const name = (read(path.join(profileDir(data), 'profile.json'))?.name || '').split(' ')[0];
  const days = last ? Math.floor((now - last) / 864e5) : null, due = (read(path.join(profileDir(data), 'review.json'))?.cards || []).filter(c => c.dueAt <= now).length;
  const body = `${name ? `${name}, ` : ''}${days == null ? 'you have not started studying yet.' : days < 1 ? 'you have not studied today.' : `it has been ${days} day${days === 1 ? '' : 's'} since you studied.`}${due ? ` ${due} card${due === 1 ? ' is' : 's are'} due for review.` : ''} Ten minutes keeps the streak alive.`;
  if (dry) { console.log('would notify:', body); process.exit(0); }
  execFile('notify-send', ['--app-name=Cram', 'Time to study', body], e => {
    if (e) { console.error(e.message); process.exit(1); }
    fs.writeFileSync(stateFile, JSON.stringify({ day: new Date(now).toDateString(), at: now }));
  });
}
