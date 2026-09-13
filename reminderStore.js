// Study reminders on disk (DATA/reminders.json), so remind.js can fire them while Cram is closed.
// Shape: { list: [{ id, time, days, label, on, snoozeUntil }], fired: { id: 'YYYY-MM-DD' }, whenClosed: boolean }
// While the server runs it writes a heartbeat (DATA/app-alive); remind.js stays quiet while that is fresh,
// because the app shows those alerts itself.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TAG = '# cram-reminder-custom';
const EMPTY = { list: [], fired: {}, whenClosed: true };

module.exports = (app, { DATA }) => {
  const FILE = path.join(DATA, 'reminders.json'), ALIVE = path.join(DATA, 'app-alive');
  const read = () => { try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...EMPTY }; } };
  const write = d => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(d)); fs.renameSync(FILE + '.tmp', FILE); }; // atomic: remind.js may read it any minute
  const beat = () => { try { fs.writeFileSync(ALIVE, String(Date.now())); } catch {} };
  beat(); setInterval(beat, 20000).unref();

  const supported = process.platform === 'linux';
  const wantsCron = d => supported && d.whenClosed !== false && d.list.some(r => r.on);
  // one per-minute crontab line while any reminder is on and "also when closed" is set; none otherwise.
  // CRAM_NO_CRON=1 (tests) skips the crontab entirely.
  const syncCron = d => new Promise(resolve => {
    if (!supported || process.env.CRAM_NO_CRON) return resolve(true);
    execFile('crontab', ['-l'], (e, out) => {
      const keep = (e ? '' : out).split('\n').filter(l => l.trim() && !l.includes(TAG));
      const q = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
      if (wantsCron(d)) keep.push(`* * * * * DBUS_SESSION_BUS_ADDRESS=${q(`unix:path=/run/user/${process.getuid()}/bus`)} ELECTRON_RUN_AS_NODE=1 ${q(process.execPath)} ${q(path.join(__dirname, 'remind.js'))} ${q(DATA)} --custom ${TAG}`);
      const p = execFile('crontab', ['-'], err => resolve(!err)); p.stdin.end(keep.join('\n') + '\n');
    });
  });
  const clean = r => ({ id: String(r.id || Date.now().toString(36)).slice(0, 40), time: /^\d{2}:\d{2}$/.test(r.time) ? r.time : '19:00', days: [...new Set((r.days || []).map(Number).filter(x => x >= 0 && x <= 6))].sort(),
    label: String(r.label || 'Time to study').slice(0, 120), on: !!r.on, snoozeUntil: +r.snoozeUntil || null });

  app.get('/api/reminders', (req, res) => res.json({ ...read(), cron: supported }));
  // save the list and/or the whenClosed switch; the crontab line follows along
  app.post('/api/reminders', async (req, res) => {
    const before = read(), d = { ...before };
    if (Array.isArray(req.body?.list)) d.list = req.body.list.slice(0, 50).map(clean);
    if ('whenClosed' in (req.body || {})) d.whenClosed = !!req.body.whenClosed;
    d.fired = Object.fromEntries(Object.entries(d.fired || {}).filter(([id]) => d.list.some(r => r.id === id)));
    write(d);
    const cronOk = wantsCron(before) === wantsCron(d) ? true : await syncCron(d);
    res.json({ ...d, cron: supported, cronOk });
  });
  // the app showed these alerts: remember it for today and clear any snooze
  app.post('/api/reminders/fired', (req, res) => {
    const d = read(), ids = new Set((req.body?.ids || []).map(String)), day = String(req.body?.day || '');
    for (const id of ids) d.fired[id] = day;
    d.list = d.list.map(r => ids.has(r.id) ? { ...r, snoozeUntil: null } : r);
    write(d); res.json({ ok: true });
  });
  // re-sync on start, in case the crontab was edited by hand or the app moved
  if (wantsCron(read())) syncCron(read());
};
module.exports.TAG = TAG;
