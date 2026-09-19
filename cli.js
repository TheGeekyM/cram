// One spawn path for every AI CLI. providers.js says which binary, which flags, and how to read
// its stream; this file runs it and turns the normalised events into { ok, text }.
//
// The Claude path is unchanged from when this file only knew Claude: same flags, same events,
// same dedup. Other providers differ in two ways that matter — no --append-system-prompt (so the
// system prompt goes at the top of the prompt) and no PDF (only Claude can be pointed at a file).
const { spawn } = require('child_process');
const os = require('os');
const providers = require('./providers');

// no argument = Claude, so old callers keep working
exports.available = (id = providers.DEFAULT_PROVIDER) => !!providers.findBin(id);

exports.stream = ({ provider = providers.DEFAULT_PROVIDER, system, messages, model, pdf, key = '',
  onDelta = () => {}, timeout = 600000, signal, web = false }) => new Promise(resolve => {
  const p = providers.PROVIDERS[provider] || providers.PROVIDERS[providers.DEFAULT_PROVIDER];
  const bin = providers.findBin(p.id);
  if (!bin) return resolve({ ok: false, message: providers.missingBinMessage(p.id) });

  const usePdf = pdf && p.pdf ? pdf : null; // a CLI that cannot read the file is not told about it
  const args = p.args({ model, system, pdf: usePdf, web });
  const convo = messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
  const head = p.sysFlag ? '' : `${system}\n\n---\n\n`; // no system flag: same words, top of the prompt
  const prompt = head
    + (usePdf ? `The study material is the PDF at ${usePdf}. Read it with the Read tool before answering (all pages that matter). Do not mention the file path or the tool.\n\n` : '')
    + convo + '\n\nAssistant:';

  let child;
  try { child = spawn(bin, args, { cwd: os.tmpdir(), env: { ...process.env, PATH: providers.enrichedPath(), ...p.env(key) } }); }
  catch (e) { return resolve({ ok: false, message: e.message }); }

  let buf = '', err = '', text = '', final = null, sawPartial = false; const t0 = Date.now(); let first = false;
  const mark = () => { if (!first) { first = true; console.log(`         [cli] ${p.cliName} first token after ${((Date.now() - t0) / 1000).toFixed(1)}s`); } };
  const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${p.label} timed out` }); }, timeout);
  signal?.addEventListener('abort', () => child.kill()); // user pressed Stop: resolve with whatever arrived

  child.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const s = line.trim(); if (!s) continue;
      let e; try { e = JSON.parse(s); } catch { continue; } // banners and other noise
      let evs; try { evs = p.parse(e) || []; } catch { evs = []; }
      for (const ev of evs) {
        if (ev.kind === 'text') {
          // Claude sends word-by-word deltas AND a whole copy of each block; gemini only whole
          // blocks. Take the deltas when there are any, the whole blocks when there are not.
          if (ev.partial) { sawPartial = true; mark(); text += ev.text; onDelta(ev.text); }
          else if (!sawPartial) { mark(); text += ev.text; onDelta(ev.text); }
        } else if (ev.kind === 'result') final = ev;
      }
    }
  });
  child.stderr.on('data', d => err += d);
  child.on('error', e => { clearTimeout(timer); resolve({ ok: false, message: e.message }); });
  child.on('close', code => {
    clearTimeout(timer);
    if (final?.error) return resolve({ ok: false, message: final.error });
    if (!text.trim() && final?.text) { text = final.text; onDelta(text); }
    if (code !== 0 && !text.trim()) return resolve({ ok: false, message: err.trim().split('\n').slice(-2).join(' ') || `${p.cliName} exited ${code}` });
    resolve({ ok: true, text });
  });
  child.stdin.end(prompt);
});
