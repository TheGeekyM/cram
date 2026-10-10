// Speech output from a choice of providers. Each one takes a sentence and a voice and returns audio;
// /api/speak in features.js picks the engine from settings and falls back to Edge, then espeak.
//   edge   — Microsoft Edge's neural voices (free, no key), voices listed live. Its own client: the
//            msedge-tts package's handshake is refused (HTTP 403) since Microsoft signs requests
//   gemini — Gemini 3.8 Flash TTS: 30 built-in voices plus Google's voice library (Egyptian ones
//            included), through the Interactions API; generateContent for the built-in voices as backup
//   openai — gpt-4o-mini-tts, 13 voices; Egyptian accent asked for by instruction (loosely followed)
// ElevenLabs stays in features.js, where its voice library and backup-key logic already live.
const WebSocket = require('ws');
const { createHash, randomUUID } = require('crypto');

const EDGE_DEFAULT = { ar: 'ar-EG-SalmaNeural', en: 'en-US-AvaMultilingualNeural' };
const GEMINI_MODEL = 'gemini-3.8-flash-tts';
const GEMINI_FALLBACK_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const GEMINI_VOICES = [
  ['Achird', 'Friendly'], ['Sulafat', 'Warm'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Puck', 'Upbeat'], ['Zephyr', 'Bright'],
  ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'],
  ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'],
  ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'],
  ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'],
].map(([id, traits]) => ({ id, name: id, traits }));
const OPENAI_VOICES = [
  ['marin', 'Recommended'], ['cedar', 'Recommended'], ['coral', 'Warm'], ['alloy', 'Neutral'], ['ash', ''], ['ballad', ''],
  ['echo', ''], ['fable', ''], ['nova', ''], ['onyx', 'Deep'], ['sage', ''], ['shimmer', ''], ['verse', ''],
].map(([id, traits]) => ({ id, name: id[0].toUpperCase() + id.slice(1), traits }));
const isAr = t => /[؀-ۿ]/.test(t);

// ── Edge ──
// Unofficial endpoint. Everything version-bound is in EDGE: mirrored from the maintained edge-tts client
// (7.2.8), so an update is a one-block change. The request is signed with the time; a 403 carries the
// server's clock, which corrects the next attempt.
const EDGE = { token: '6A5AA1D4EAFF4E9FB37E23D68491D6F4', chromium: '143.0.3650.75', base: 'speech.platform.bing.com/consumer/speech/synthesize/readaloud' };
const MAJOR = EDGE.chromium.split('.')[0];
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36 Edg/${MAJOR}.0.0.0`;
const EDGE_HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br, zstd', 'Accept-Language': 'en-US,en;q=0.9' };
let skewMs = 0;
const gec = () => { const secs = BigInt(Math.floor((Date.now() + skewMs) / 1000)) + 11644473600n; return createHash('sha256').update(`${(secs - secs % 300n) * 10000000n}${EDGE.token}`).digest('hex').toUpperCase(); };
const rid = () => randomUUID().replace(/-/g, '');
const xmlEsc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let edgeList = null;
async function edgeVoices() {
  if (!edgeList) {
    const r = await fetch(`https://${EDGE.base}/voices/list?trustedclienttoken=${EDGE.token}`, { headers: EDGE_HEADERS, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Edge voices: HTTP ${r.status}`);
    edgeList = (await r.json()).filter(v => /^(en-(US|GB|AU|IE)|ar-)/.test(v.Locale) || /Multilingual/.test(v.ShortName))
      .map(v => ({ id: v.ShortName, name: v.ShortName.replace(/^[a-z]{2}-[A-Z]{2}-|Neural$/g, '').replace(/Multilingual$/, ' (multilingual)'), traits: `${v.Locale} · ${v.Gender}`, arabic: v.Locale.startsWith('ar'), gender: String(v.Gender || '').toLowerCase() }))
      .sort((a, b) => a.traits.localeCompare(b.traits) || a.name.localeCompare(b.name));
  }
  return edgeList;
}
function edgeOnce(text, voice) {
  return new Promise((ok, fail) => {
    const url = `wss://${EDGE.base}/edge/v1?TrustedClientToken=${EDGE.token}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-${EDGE.chromium}&ConnectionId=${rid()}`;
    const ws = new WebSocket(url, { headers: { ...EDGE_HEADERS, Pragma: 'no-cache', 'Cache-Control': 'no-cache', Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold' }, family: 4, handshakeTimeout: 10000 });
    const chunks = [];
    const timer = setTimeout(() => { ws.terminate(); fail(new Error('Edge voice timed out')); }, 20000);
    let settled = false;
    const done = err => { if (settled) return; settled = true; clearTimeout(timer); err ? fail(err) : ok(Buffer.concat(chunks)); };
    ws.on('open', () => {
      const ts = new Date(Date.now() + skewMs).toUTCString().replace(/,/, '').replace(/ GMT$/, ' GMT+0000 (Coordinated Universal Time)');
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      ws.send(`X-RequestId:${rid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${xmlEsc(text)}</prosody></voice></speak>`);
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) { if (data.toString().includes('Path:turn.end')) { ws.close(); done(); } return; }
      const hl = data.readUInt16BE(0);
      if (data.toString('utf8', 2, 2 + hl).includes('Path:audio')) chunks.push(data.subarray(2 + hl));
    });
    ws.on('unexpected-response', (_, res) => {
      const server = Date.parse(res.headers.date || '');
      if (res.statusCode === 403 && server) skewMs = server - Date.now();
      done(Object.assign(new Error(`Edge refused the request (HTTP ${res.statusCode})`), { status: res.statusCode }));
    });
    ws.on('error', e => done(new Error(`Edge voice: ${e.message}`)));
    // A voice cannot read another script: Arabic text through an English voice comes back empty.
    ws.on('close', () => done(chunks.length ? null : new Error(`Edge returned no audio for ${voice}`)));
  });
}
async function edgeSpeak(text, voice) {
  let audio;
  try { audio = await edgeOnce(text, voice); }
  catch (e) { if (e.status !== 403) throw e; audio = await edgeOnce(text, voice); }   // signed again with the server's clock
  return { audio, type: 'audio/mpeg' };
}

// ── Gemini ──
const G = 'https://generativelanguage.googleapis.com/v1beta';
const gErr = async (r, who) => { const t = await r.text().catch(() => ''); let m = t; try { const j = JSON.parse(t); m = j.error?.message || t; } catch {} return Object.assign(new Error(`${who} ${r.status}: ${String(m).slice(0, 240)}`), { status: r.status }); };
const STYLE = { ar: 'warm and natural, like a friendly Egyptian colleague talking face to face, calm conversational pace', en: 'warm and natural, like a friendly colleague talking face to face, calm conversational pace' };
const wavFromPcm = (pcm, rate) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };

async function geminiSpeak(key, text, voice = 'Achird') {
  const lang = isAr(text) ? 'ar' : 'en';
  const r = await fetch(`${G}/interactions`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE[lang] }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (r.ok) {
    const j = await r.json();
    const a = (j.steps || []).flatMap(s => s.content || []).filter(c => c?.data && (c.type === 'audio' || /audio/.test(c.mime_type || c.mimeType || ''))).pop() || j.output_audio;
    if (a?.data) return { audio: Buffer.from(a.data, 'base64'), type: 'audio/wav' };
    throw new Error('Gemini returned no audio');
  }
  // The older generateContent route speaks only the 30 built-in voices.
  const e = await gErr(r, 'Gemini TTS');
  if (!GEMINI_VOICES.some(v => v.id === voice)) throw e;
  for (const model of GEMINI_FALLBACK_MODELS) {
    const r2 = await fetch(`${G}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ contents: [{ parts: [{ text: `Say this ${STYLE[lang]}:\n${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    if (r2.status === 404) continue;
    if (!r2.ok) throw await gErr(r2, 'Gemini TTS');
    const audio = (await r2.json()).candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
    if (!audio) throw new Error('Gemini returned no audio');
    return { audio: wavFromPcm(Buffer.from(audio.data, 'base64'), +(/rate=(\d+)/.exec(audio.mimeType || '')?.[1]) || 24000), type: 'audio/wav' };
  }
  throw e;
}
/** Google's library voices matching a search ("Egyptian"), then the 30 built-in ones. */
async function geminiVoices(key, search) {
  let found = [];
  if (key && search) {
    const r = await fetch(`${G}/voices?search=${encodeURIComponent(search)}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) });
    if (r.ok) found = ((await r.json()).voices || []).map(v => ({ id: v.id || v.name, name: v.display_name || v.displayName || v.id, traits: [v.accent, v.description].filter(Boolean).join(' · '), arabic: /arab|egypt/i.test(`${v.accent} ${v.language_code} ${v.description} ${v.display_name}`) }));
  }
  return [...found, ...GEMINI_VOICES];
}

// ── OpenAI ──
async function openaiSpeak(key, text, voice = 'marin') {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3',
      instructions: isAr(text)
        ? 'Speak Egyptian Arabic with a natural Cairo accent, warm and conversational, like a friendly colleague. Not formal Modern Standard Arabic.'
        : 'Speak warmly and naturally, like a helpful colleague. Conversational pace.',
    }),
  });
  if (!r.ok) throw await gErr(r, 'OpenAI TTS');
  return { audio: Buffer.from(await r.arrayBuffer()), type: 'audio/mpeg' };
}

module.exports = { EDGE_DEFAULT, GEMINI_VOICES, OPENAI_VOICES, edgeVoices, edgeSpeak, geminiSpeak, geminiVoices, openaiSpeak, wavFromPcm };
