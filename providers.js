// Every AI CLI Cram can drive, in one table.
//
// Cram was written against the Claude CLI: `claude -p --output-format stream-json`, its
// {assistant, stream_event, result} events, its --disallowedTools guarantee. A provider entry
// says how to ask a different binary for the same thing and normalises its stream back into
// one small vocabulary. Nothing outside this file and cli.js knows another CLI exists.
//
// NORMALISED events — all the rest of the app sees:
//   { kind: 'text',   text, partial }   partial = a streaming delta, not a whole block
//   { kind: 'result', text, error }     end of the run
//
// Cram's difference from an agentic coding tool: almost every call goes through json0() and
// must come back as parseable JSON. So non-Claude providers run with every tool denied and the
// system prompt inlined — an agent that can call tools is an agent that can narrate instead of
// answering, and jsonish.parse cannot rescue that.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude's tool names. Denied wholesale for JSON work; the PDF path keeps Read.
const NO_TOOLS = 'Write,Edit,MultiEdit,NotebookEdit,Bash,Read,Grep,Glob,LS,WebFetch,WebSearch,Task,Agent,TodoWrite';
const READ_ONLY = NO_TOOLS.replace('Read,', '');
// The same tools in the gemini-CLI family's vocabulary (gemini, qwen).
const GEM_TOOLS = ['read_file', 'read_many_files', 'write_file', 'replace', 'run_shell_command',
  'glob', 'search_file_content', 'list_directory', 'web_fetch', 'google_web_search'];

// A GUI-launched app inherits a stripped PATH — the classic "spawn claude ENOENT" even though
// it runs fine in a terminal. Ask the login shell what PATH really is, once.
let PATH_CACHE = null;
function enrichedPath() {
  if (PATH_CACHE) return PATH_CACHE;
  const parts = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  if (process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/bash';
      const out = execSync(`${shell} -lc 'echo $PATH'`, { timeout: 4000, encoding: 'utf8' });
      out.trim().split('\n').pop().split(path.delimiter).filter(Boolean).forEach(p => parts.add(p));
    } catch { /* keep the inherited PATH */ }
  }
  const home = os.homedir();
  for (const d of [path.join(home, '.claude/local'), path.join(home, '.local/bin'), path.join(home, '.bun/bin'),
    path.join(home, '.npm-global/bin'), path.join(home, '.cursor/bin'), path.join(home, '.codex/bin'),
    '/usr/local/bin', '/opt/homebrew/bin']) parts.add(d);
  PATH_CACHE = [...parts].join(path.delimiter);
  return PATH_CACHE;
}

// ---------- parsers ----------
// Claude Code's stream-json. Also used by qwen (same envelope) and cursor-agent (deliberately mirrors it).
function claudeParse(evt) {
  const out = [];
  if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.text) {
    out.push({ kind: 'text', text: evt.event.delta.text, partial: true });
  } else if (evt.event?.type === 'content_block_delta' && evt.event.delta?.text) {
    out.push({ kind: 'text', text: evt.event.delta.text, partial: true });
  } else if (evt.type === 'assistant') {
    for (const b of evt.message?.content || []) if (b.type === 'text' && b.text) out.push({ kind: 'text', text: b.text, partial: false });
  } else if (evt.type === 'result') {
    // is_error is not the whole story: running out of turns is reported as an error_* subtype
    // with is_error unset. Treating that as success is how an empty answer looks like an answer.
    const failed = !!evt.is_error || /^error/.test(evt.subtype || '');
    out.push({ kind: 'result', text: failed ? '' : (evt.result || ''), error: failed ? (evt.error?.message || evt.result || evt.subtype || 'CLI error') : null });
  }
  return out;
}
// gemini-cli's stream-json. Its answer arrives only as whole assistant blocks — no deltas —
// so anything watching progress goes quiet on this provider.
function geminiParse(evt) {
  const out = [];
  if (evt.type === 'message' && evt.role === 'assistant' && evt.content) out.push({ kind: 'text', text: evt.content, partial: false });
  else if (evt.type === 'error' && evt.severity === 'error') out.push({ kind: 'result', text: '', error: evt.message || 'Gemini CLI error' });
  else if (evt.type === 'result') out.push({ kind: 'result', text: '', error: evt.status && evt.status !== 'success' ? (evt.error?.message || evt.status) : null });
  return out;
}
// Codex's `exec --json`. Its event names have moved across releases, so both shapes are matched.
// ponytail: written from Codex's documented shape, never run here — the CLI is not installed.
function codexParse(evt) {
  const out = [];
  const msg = evt.msg || evt, item = evt.item || msg.item || null;
  const type = item?.item_type || item?.type || msg.type || evt.type || '';
  if (/agent_message_delta|output_text\.delta/.test(type)) { const t = msg.delta || msg.text || ''; if (t) out.push({ kind: 'text', text: t, partial: true }); }
  else if (/agent_message$|assistant_message/.test(type)) { const t = item?.text || msg.message || msg.text || ''; if (t) out.push({ kind: 'text', text: t, partial: false }); }
  else if (/turn\.completed|task_complete/.test(type)) out.push({ kind: 'result', text: msg.last_agent_message || '', error: null });
  else if (/turn\.failed|^error$/.test(type)) out.push({ kind: 'result', text: '', error: msg.message || msg.error?.message || 'Codex error' });
  return out;
}

// args({ model, system, pdf, web }) → argv. `system` is only passed when sysFlag is true;
// otherwise cli.js puts it at the top of the prompt instead.
const claudeArgs = ({ model, system, pdf, web }) => {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model,
    '--permission-mode', 'bypassPermissions', '--append-system-prompt', system,
    '--disallowedTools', (pdf ? READ_ONLY : NO_TOOLS).replace(web ? 'WebFetch,WebSearch,' : '\0', '')];
  if (pdf) a.push('--add-dir', path.dirname(pdf));
  return a;
};
// gemini and qwen: no --append-system-prompt and no --disallowedTools. qwen takes --exclude-tools;
// gemini needs a policy file, so for now it is simply given nothing to read (no PDF support).
const gemArgs = partials => ({ model }) => {
  const a = ['-o', 'stream-json', '-m', model, '--approval-mode', 'yolo', '--exclude-tools', GEM_TOOLS.join(',')];
  if (partials) a.push('--include-partial-messages');
  return a;
};

const CLAUDE_BINS = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];

const PROVIDERS = {
  claude: {
    id: 'claude', label: 'Claude', cliName: 'claude', bins: CLAUDE_BINS,
    note: 'Uses your Claude Code login — no API key needed. Also the only provider that can read a PDF study.',
    key: null, sysFlag: true, pdf: true, env: () => ({}),
    models: [
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
    args: claudeArgs, parse: claudeParse,
  },
  kimi: {
    id: 'kimi', label: 'Kimi (Moonshot)', cliName: 'claude', bins: CLAUDE_BINS,
    // Moonshot publishes an Anthropic-compatible endpoint, so the Claude CLI drives it unchanged —
    // and so does the Anthropic SDK with a baseURL, which is why this one works without the CLI too.
    note: 'Runs through the Claude CLI (or the API directly) pointed at Moonshot\'s Anthropic-compatible endpoint.',
    key: { label: 'Moonshot API key', url: 'https://platform.moonshot.ai/console/api-keys' },
    baseURL: 'https://api.moonshot.ai/anthropic',
    sysFlag: true, pdf: false,
    env: key => ({ ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic', ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: key }),
    models: [
      { id: 'kimi-k2-thinking', label: 'K2 Thinking' },
      { id: 'kimi-k2-turbo-preview', label: 'K2 Turbo' },
      { id: 'kimi-latest', label: 'Kimi Latest' },
    ],
    args: claudeArgs, parse: claudeParse,
  },
  qwen: {
    id: 'qwen', label: 'Qwen', cliName: 'qwen',
    bins: process.platform === 'win32' ? ['qwen.cmd', 'qwen'] : ['qwen'],
    note: 'Needs the Qwen CLI (npm i -g @qwen-code/qwen-code) and a one-time `qwen` sign-in in a terminal.',
    key: { label: 'OpenAI-compatible API key (optional)', url: 'https://bailian.console.aliyun.com/', optional: true },
    sysFlag: false, pdf: false, partials: true,
    env: key => (key ? { OPENAI_API_KEY: key } : {}),
    models: [
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
      { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash' },
    ],
    args: gemArgs(true), parse: claudeParse, // gemini-style flags, Claude-style stream envelope
  },
  gemini: {
    id: 'gemini', label: 'Gemini', cliName: 'gemini',
    bins: process.platform === 'win32' ? ['gemini.cmd', 'gemini'] : ['gemini'],
    note: 'Needs the Gemini CLI (npm i -g @google/gemini-cli). Sends whole answers, not word by word, so progress bars stay still.',
    key: { label: 'Gemini API key (optional)', url: 'https://aistudio.google.com/apikey', optional: true },
    sysFlag: false, pdf: false,
    env: key => (key ? { GEMINI_API_KEY: key } : {}),
    models: [
      { id: 'gemini-2.5-pro', label: '2.5 Pro' },
      { id: 'gemini-2.5-flash', label: '2.5 Flash' },
    ],
    args: gemArgs(false), parse: geminiParse,
  },
  gpt: {
    id: 'gpt', label: 'GPT (Codex)', cliName: 'codex',
    bins: process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'],
    note: 'Needs the Codex CLI (npm i -g @openai/codex). Untested here — no Codex binary on this machine.',
    key: { label: 'OpenAI API key (optional)', url: 'https://platform.openai.com/api-keys', optional: true },
    sysFlag: false, pdf: false,
    env: key => (key ? { OPENAI_API_KEY: key } : {}),
    models: [
      { id: 'gpt-5.1-codex', label: '5.1 Codex' },
      { id: 'gpt-5.1', label: '5.1' },
    ],
    args: ({ model }) => ['exec', '--json', '--skip-git-repo-check', '-m', model, '--sandbox', 'read-only', '-'],
    parse: codexParse,
  },
  cursor: {
    id: 'cursor', label: 'Cursor', cliName: 'cursor-agent',
    bins: process.platform === 'win32' ? ['cursor-agent.cmd', 'cursor-agent.exe', 'cursor-agent'] : ['cursor-agent'],
    note: 'Needs the Cursor CLI (curl https://cursor.com/install -fsS | bash) and `cursor-agent login`. Untested here.',
    key: { label: 'Cursor API key (optional)', url: 'https://cursor.com/dashboard', optional: true },
    sysFlag: false, pdf: false,
    env: key => (key ? { CURSOR_API_KEY: key } : {}),
    models: [{ id: 'auto', label: 'Auto' }, { id: 'sonnet-4.5', label: 'Sonnet 4.5' }, { id: 'gpt-5', label: 'GPT-5' }],
    args: ({ model }) => ['-p', '--output-format', 'stream-json', '-m', model],
    parse: claudeParse,
  },
};

const DEFAULT_PROVIDER = 'claude';
const DEFAULT_MODEL = 'claude:claude-opus-5';

// A model is stored as "provider:model" so one string carries both. A bare id is an old
// setting and means Claude. The model half may itself contain colons — never split naively.
function parseModel(s) {
  const str = String(s || '');
  const i = str.indexOf(':');
  const head = i > 0 ? str.slice(0, i) : '';
  if (PROVIDERS[head]) return { provider: head, model: str.slice(i + 1) || PROVIDERS[head].models[0].id };
  return { provider: DEFAULT_PROVIDER, model: str || PROVIDERS[DEFAULT_PROVIDER].models[0].id };
}
const joinModel = (provider, model) => `${provider}:${model}`;
// Is this a model we know? Used to validate what the settings page sends.
const knownModel = s => { const { provider, model } = parseModel(s); return PROVIDERS[provider]?.models.some(m => m.id === model); };

// Where a CLI can live. fs.existsSync only — never spawn to find out whether something exists.
function findBin(providerId) {
  const p = PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
  for (const d of enrichedPath().split(path.delimiter)) {
    if (!d) continue;
    for (const n of p.bins) { const full = path.join(d, n); try { if (fs.existsSync(full)) return full; } catch {} }
  }
  return null;
}
const missingBinMessage = id => {
  const p = PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
  return `${p.label} is not set up. Cram runs the \`${p.cliName}\` command and cannot see it. ${p.note}`;
};

// What the settings page needs: metadata only — the functions stay in this process.
const list = keys => Object.values(PROVIDERS).map(p => ({
  id: p.id, label: p.label, cliName: p.cliName, note: p.note, key: p.key, models: p.models,
  installed: !!findBin(p.id), hasKey: !!(keys || {})[p.id], direct: !!p.baseURL,
}));

module.exports = { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL, parseModel, joinModel, knownModel, findBin, missingBinMessage, list, enrichedPath, NO_TOOLS, READ_ONLY };
