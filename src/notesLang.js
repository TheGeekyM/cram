import hljs from 'highlight.js/lib/common'

// Language detection for notes code blocks. Kept out of NotesScreen.jsx so the check
// next to it (node src/notesLang.check.mjs) can import the real thing.

// Languages offered in the code-block picker — lowlight's `common` bundle.
export const LANGS = ['javascript', 'typescript', 'python', 'php', 'sql', 'json', 'bash', 'xml', 'css', 'java', 'go', 'rust', 'yaml', 'markdown', 'diff']

// hljs's own auto-detect reads a plain JS function as CSS and prose as SQL, so check the
// unmistakable markers first and only fall back to it for anything unrecognised.
// ponytail: first match wins, so order matters — narrow signatures before broad ones.
const SIGNS = [
  [/<\?php|\$\w+\s*->|\bfunction\s+\w+\s*\(.*\)\s*:\s*\w+\s*\{/, 'php'],
  [/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/im, 'sql'],
  // Python imports carry no quotes — `import OpenAI from 'openai'` must stay JavaScript.
  [/^\s*(?:def|class)\s+\w+.*:\s*$|^\s*from\s+[\w.]+\s+import\b|^\s*import\s+[\w.]+\s*$/m, 'python'],
  [/^\s*(?:interface|type)\s+\w+\s*[={]|:\s*(?:string|number|boolean)\b|\bas\s+\w+;/m, 'typescript'],
  [/=>|\b(?:const|let|var)\s+\w+\s*=|^\s*(?:import|export)\s|\bfunction\s*\w*\s*\(|console\.log\(/m, 'javascript'],
  [/^#!.*\b(?:ba|z|)sh\b|^\s*(?:npm|npx|yarn|git|cd|sudo|apt|docker|chmod)\s/m, 'bash'],
  [/^\s*[{[][\s\S]*["\d}\]]\s*$/, 'json'],
  [/^\s*(?:package|import)\s+[\w.]+;|\bpublic\s+(?:static\s+)?(?:class|void)\b/m, 'java'],
  [/^\s*(?:func|package)\s+\w+|:=/m, 'go'],
  [/^\s*(?:fn|impl|pub\s+fn)\s+\w+|\blet\s+mut\b/m, 'rust'],
  [/^\s*[.#]?[\w-]+\s*\{[^}]*:\s*[^;]+;/m, 'css'],
  [/^\s*<(?:!DOCTYPE|html|div|span|p|a|body|head)\b/im, 'xml'],
  [/^\s*[-+]{3}\s|^\s*@@ -\d/m, 'diff'],
]

// null when nothing is confident enough — the block then highlights without a label
// rather than claiming a language it guessed.
export function detectLang(text) {
  const t = (text || '').trim()
  if (t.length < 3) return null
  for (const [re, lang] of SIGNS) if (re.test(t)) return lang
  const r = hljs.highlightAuto(t, LANGS)
  return r.language && r.relevance >= 8 ? r.language : null
}
