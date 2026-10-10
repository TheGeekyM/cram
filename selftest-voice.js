// node selftest-voice.js — the voice engines through the real server, on a throwaway data folder.
// Edge needs the network; Gemini runs only when CRAM_TEST_GEMINI_KEY is set; OpenAI is checked
// without a key (it must fall back to Edge, not fail).
const assert = require('assert');
process.env.CRAM_DATA = require('fs').mkdtempSync(require('os').tmpdir() + '/cram-voice-');
const app = require('./server.js');

const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`, H = { 'Content-Type': 'application/json', cookie: `cram_key=${app.accessKey()}` };
  const json = (m, u, b) => fetch(base + u, { method: m, headers: H, body: b && JSON.stringify(b) }).then(r => r.json());
  const audio = async (u, b) => { const r = await fetch(base + u, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { type: r.headers.get('content-type') || '', bytes: (await r.arrayBuffer()).byteLength }; };
  try {
    // Settings keep the new choices — and refuse junk.
    await json('POST', '/api/settings', { voiceEngine: 'edge', edgeVoices: { ar: 'ar-EG-ShakirNeural', en: '<script>' } });
    let s = await json('GET', '/api/settings');
    assert.equal(s.voiceEngine, 'edge'); assert.equal(s.edgeVoices.ar, 'ar-EG-ShakirNeural'); assert.equal(s.edgeVoices.en, undefined);
    await json('POST', '/api/settings', { voiceEngine: 'nonsense' });
    assert.equal((await json('GET', '/api/settings')).voiceEngine, 'edge');

    // Edge: the list, a preview, and speaking Arabic with the chosen voice.
    const edge = (await json('GET', '/api/voice/voices?engine=edge')).voices;
    assert.ok(edge.length > 30 && edge.some(v => v.id === 'ar-EG-ShakirNeural'), `edge voices: ${edge.length}`);
    // Edge's speaking endpoint is unofficial and sometimes refuses us: then /api/speak must still answer
    // (espeak), and the run says Edge is down rather than failing.
    let a = await audio('/api/voice/try', { engine: 'edge', voice: 'ar-EG-ShakirNeural', lang: 'ar' });
    const edgeUp = a.type.startsWith('audio/mpeg') && a.bytes > 5000;
    a = await audio('/api/speak', { text: 'عندك تلات مهام النهارده.' });
    if (edgeUp) assert.ok(a.type.startsWith('audio/mpeg') && a.bytes > 5000, JSON.stringify(a));
    else assert.ok(a.type.startsWith('application/json'), 'with Edge down, speak should fall back to espeak');
    console.log('edge: list', edge.length, edgeUp ? '· preview and speak ok' : '· speaking UNAVAILABLE right now (Edge refuses) — fell back to espeak');

    // OpenAI with no key: falls back to Edge instead of failing.
    await json('POST', '/api/settings', { voiceEngine: 'openai', openaiVoice: 'marin' });
    a = await audio('/api/speak', { text: 'Hello there, three tasks today.' });
    assert.ok(edgeUp ? a.type.startsWith('audio/mpeg') : a.type.startsWith('application/json'), JSON.stringify(a));
    assert.equal((await json('GET', '/api/voice/voices?engine=openai')).voices.length, 13);
    console.log('openai without a key: fell back to Edge');

    // Gemini, live, when a key is given.
    const gk = process.env.CRAM_TEST_GEMINI_KEY;
    if (gk) {
      await json('POST', '/api/settings', { geminiKey: gk, voiceEngine: 'gemini', geminiVoice: 'Achird' });
      const lib = (await json('GET', '/api/voice/voices?engine=gemini&search=Egyptian')).voices;
      const egy = lib.find(v => /egypt/i.test(v.traits || ''));
      assert.ok(egy, 'no Egyptian library voice found');
      a = await audio('/api/speak', { text: 'عندك تلات مهام النهارده، تحب نبدأ بإيه؟' });
      assert.ok(a.type.startsWith('audio/wav') && a.bytes > 20000, JSON.stringify(a));
      a = await audio('/api/voice/try', { engine: 'gemini', voice: egy.id, lang: 'ar' });
      assert.ok(a.type.startsWith('audio/wav') && a.bytes > 20000, JSON.stringify(a));
      console.log('gemini: built-in voice and library voice', egy.id, 'ok;', lib.length, 'voices listed');
    } else console.log('gemini: skipped (set CRAM_TEST_GEMINI_KEY)');
    console.log('selftest-voice: ok');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  finally { srv.close(); process.exit(); }
});
