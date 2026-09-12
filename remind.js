// Offline study reminder, run hourly by cron (switched on from Settings). Sends at most one desktop
// notification a day, after the chosen hour, when nothing was studied in the last 20 hours.
// Usage: remind.js <data dir> [--hour 19] [--dry-run]
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function lastActivity(data) {
  const dir = path.join(data, 'studies'); let last = 0;
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const s = read(path.join(dir, id, 'study.json')); if (!s) continue;
    last = Math.max(last, s.updatedAt || 0, ...(s.quizzes || []).map(q => q.at || 0), ...(s.challenges || []).map(c => c.at || 0),
      ...(s.interviews || []).flatMap(i => [i.at || 0, ...(i.turns || []).map(t => t.at || 0)]));
  }
  for (const c of read(path.join(data, 'review.json'))?.cards || []) last = Math.max(last, c.lastAt || 0);
  return last;
}
const shouldNotify = ({ now, last, hour, notifiedDay }) => { const d = new Date(now); return d.getHours() >= hour && notifiedDay !== d.toDateString() && now - last > 20 * 36e5; };
module.exports = { shouldNotify, lastActivity };

if (require.main === module) {
  const argv = process.argv.slice(2), data = argv[0], hour = +(argv.join(' ').match(/--hour (\d+)/)?.[1] ?? 19), dry = argv.includes('--dry-run');
  if (!data || !fs.existsSync(data)) { console.error('usage: remind.js <data dir> [--hour 19] [--dry-run]'); process.exit(2); }
  const stateFile = path.join(data, 'remind-state.json'), state = read(stateFile) || {}, now = Date.now(), last = lastActivity(data);
  if (!shouldNotify({ now, last, hour, notifiedDay: state.day })) { if (dry) console.log('no reminder due'); process.exit(0); }
  const name = (read(path.join(data, 'profile.json'))?.name || '').split(' ')[0];
  const days = last ? Math.floor((now - last) / 864e5) : null, due = (read(path.join(data, 'review.json'))?.cards || []).filter(c => c.dueAt <= now).length;
  const body = `${name ? `${name}, ` : ''}${days == null ? 'you have not started studying yet.' : days < 1 ? 'you have not studied today.' : `it has been ${days} day${days === 1 ? '' : 's'} since you studied.`}${due ? ` ${due} card${due === 1 ? ' is' : 's are'} due for review.` : ''} Ten minutes keeps the streak alive.`;
  if (dry) { console.log('would notify:', body); process.exit(0); }
  execFile('notify-send', ['--app-name=Cram', 'Time to study', body], e => {
    if (e) { console.error(e.message); process.exit(1); }
    fs.writeFileSync(stateFile, JSON.stringify({ day: new Date(now).toDateString(), at: now }));
  });
}
