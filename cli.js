// Claude Code CLI as a provider: uses the user's Claude login with no API rate limits (same
// trick as aidle). Streams text deltas from `claude -p --output-format stream-json`.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NO_TOOLS = 'Write,Edit,MultiEdit,NotebookEdit,Bash,Read,Grep,Glob,LS,WebFetch,WebSearch,Task,Agent,TodoWrite';
const READ_ONLY = NO_TOOLS.replace('Read,', '');

function bin() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local/bin'), '/usr/local/bin', path.join(os.homedir(), '.npm-global/bin'), '/opt/homebrew/bin'];
  for (const d of dirs) { const p = path.join(d, 'claude'); if (d && fs.existsSync(p)) return p; }
  return null;
}
exports.available = () => !!bin();

// messages: [{role, content:string}] → one prompt on stdin. ponytail: history is flattened
// into the prompt; switch to --resume session ids if long chats get slow.
exports.stream = ({ system, messages, model, pdf, onDelta = () => {}, timeout = 600000, signal }) => new Promise(resolve => {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model,
    '--permission-mode', 'bypassPermissions', '--append-system-prompt', system, '--disallowedTools', pdf ? READ_ONLY : NO_TOOLS];
  if (pdf) args.push('--add-dir', path.dirname(pdf));
  const convo = messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
  const prompt = (pdf ? `The study material is the PDF at ${pdf}. Read it with the Read tool before answering (all pages that matter). Do not mention the file path or the tool.\n\n` : '') + convo + '\n\nAssistant:';
  let child; try { child = spawn(bin(), args, { cwd: os.tmpdir(), env: { ...process.env, PATH: [process.env.PATH, path.join(os.homedir(), '.local/bin'), '/usr/local/bin'].join(path.delimiter) } }); }
  catch (e) { return resolve({ ok: false, message: e.message }); }
  let buf = '', err = '', text = '', final = null, sawPartial = false; const t0 = Date.now(); let first = false;
  const mark = () => { if (!first) { first = true; console.log(`         [cli] first token after ${((Date.now() - t0) / 1000).toFixed(1)}s`); } };
  const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: 'Claude CLI timed out' }); }, timeout);
  signal?.addEventListener('abort', () => child.kill()); // user pressed Stop: close resolves with whatever text arrived
  child.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.text) { mark(); sawPartial = true; text += e.event.delta.text; onDelta(e.event.delta.text); }
      else if (e.type === 'assistant' && !sawPartial) for (const b of e.message?.content || []) if (b.type === 'text' && b.text) { text += b.text; onDelta(b.text); }
      else if (e.type === 'assistant') for (const b of e.message?.content || []) if (b.type === 'tool_use') console.log(`         [cli] tool ${b.name} ${JSON.stringify(b.input).slice(0, 80)}`);
      else if (e.type === 'result') final = e;
    }
  });
  child.stderr.on('data', d => err += d);
  child.on('error', e => { clearTimeout(timer); resolve({ ok: false, message: e.message }); });
  child.on('close', code => {
    clearTimeout(timer);
    const failed = final?.is_error || /^error/.test(final?.subtype || '');
    if (failed) return resolve({ ok: false, message: final.result || final.subtype });
    if (!text.trim() && final?.result) { text = final.result; onDelta(text); }
    if (code !== 0 && !text.trim()) return resolve({ ok: false, message: err.trim().split('\n').slice(-2).join(' ') || `claude exited ${code}` });
    resolve({ ok: true, text });
  });
  child.stdin.end(prompt);
});
