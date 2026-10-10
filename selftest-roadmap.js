// Self-check for the roadmap routes, with the model call faked through the app.json seam. Run: node selftest-roadmap.js
const assert = require('assert');
process.env.CRAM_DATA = require('fs').mkdtempSync(require('os').tmpdir() + '/cram-rm-');
process.env.CRAM_NO_CRON = '1';
const app = require('./server.js');
let prompt = '';
app.json = async (s, p) => { prompt = p; return { title: 'To staff engineer', summary: 's', reality: 'ok', finish: 'f',
  stages: [{ title: 'A', goal: 'g', duration: 'M1', steps: [{ title: 'x', detail: 'd' }, { title: 'y' }, { detail: 'no title, dropped' }] }, { title: 'empty', steps: [] }, { steps: [{ title: 'no stage title' }] }] }; };
const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`, H = { 'Content-Type': 'application/json', cookie: `cram_key=${app.accessKey()}` };
  const call = (m, u, b) => fetch(base + u, { method: m, headers: H, body: b && JSON.stringify(b) }).then(r => r.json().then(j => [r.status, j]));
  let [st, r] = await call('POST', '/api/roadmap', { path: 'grow', now: '' , target: 'x' });
  assert.equal(st, 400);
  [st, r] = await call('POST', '/api/roadmap', { path: 'lead', now: 'mid dev', target: 'staff', months: 999, hours: 10, language: 'Arabic' });
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.months, 60); assert.equal(r.plan.stages.length, 1); assert.deepEqual(r.plan.stages[0].steps.map(t => t.id), ['0.0', '0.1']);
  assert.match(prompt, /promoted/); assert.match(prompt, /Egyptian/);
  [st] = await call('POST', `/api/roadmap/${r.id}`, { done: ['0.1'] }); assert.equal(st, 200);
  [st, r] = await call('GET', '/api/roadmap'); assert.deepEqual(r[0].done, ['0.1']);
  [st] = await call('DELETE', `/api/roadmap/${r[0].id}`); [st, r] = await call('GET', '/api/roadmap'); assert.equal(r.length, 0);
  [st] = await call('POST', '/api/roadmap', { kind: 'skill', skill: '' }); assert.equal(st, 400);
  [st, r] = await call('POST', '/api/roadmap', { kind: 'skill', skill: 'DDD', level: 'beginner', now: 'backend dev' });
  assert.equal(st, 200, JSON.stringify(r)); assert.equal(r.kind, 'skill'); assert.equal(r.now, 'Beginner in DDD\nbackend dev'); assert.equal(r.target, 'Expert in DDD');
  assert.match(prompt, /master: DDD/); assert.match(prompt, /"level"/); assert.equal(r.path, undefined);
  let sid; [st, { id: sid }] = await call('POST', `/api/roadmap/${r.id}/study`); assert.equal(st, 200);
  [st, s] = await call('GET', `/api/studies/${sid}`);
  assert.equal(s.title, 'To staff engineer'); assert.equal(s.level, 'beginner'); assert.equal(s.outline.from, 'roadmap');
  assert.deepEqual(s.outline.items, [{ title: 'x', desc: 'd', depth: 0 }, { title: 'y', desc: '', depth: 0 }]);
  [st, s] = await call('POST', `/api/roadmap/${r.id}/study`); assert.equal(s.id, sid, 'a second click opens the same study');
  [st, s] = await call('GET', `/api/studies/${sid}/outline`); assert.equal(s.from, 'roadmap', 'never re-planned');
  console.log('roadmap API OK'); srv.close(); process.exit(0);
});
