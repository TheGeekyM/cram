// Minimal Markdown → HTML for AI assist output (headers, bold, code, fenced code
// blocks, bullet/number lists, horizontal rules, paragraphs). ponytail: covers the
// subset our prompts emit, not full CommonMark. Swap in `marked` if the output ever
// needs tables/links/nesting.
// Output is still run through the DOM sanitizer before rendering.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline: escape first (handles special chars safely), then bold + inline code.
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')      // after bold: what's left is italic
  .replace(/`([^`]+?)`/g, '<code>$1</code>')

// `shift` moves every heading down that many levels — 1 by default so an assist reply's "#"
// isn't a giant h1 next to the app's own chrome. Exported documents pass 0: there the "#" line
// IS the document title.
export function mdToHtml(md, { shift = 1 } = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let list = null            // 'ul' | 'ol' | null
  let para = []
  let code = null            // lines inside a ``` fence, or null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = [] } }
  const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    let m
    if (/^\s*```/.test(line)) {
      if (code === null) { flushPara(); closeList(); code = [] }
      else { out.push(`<pre><code>${code.map(esc).join('\n')}</code></pre>`); code = null }
      continue
    }
    if (code !== null) { code.push(raw); continue }
    if (!line.trim()) { flushPara(); closeList(); continue }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); closeList()
      const lvl = Math.min(Math.max(m[1].length + shift, 1), 6)
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); continue
    }
    // Pipe table: a header row, a |---|---| separator, then body rows. Ragged rows are padded
    // to the header width — a short row would otherwise silently shift every cell after it.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s|:-]*-[\s|:-]*\|?\s*$/.test(lines[i + 1] || '')) {
      flushPara(); closeList()
      const head = row(line)
      const body = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(row(lines[i])); i++ }
      i--   // the for-loop's i++ steps past the line that ended the table
      out.push(`<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>` +
        body.map(r => `<tr>${head.map((_, j) => `<td>${inline(r[j] || '')}</td>`).join('')}</tr>`).join('') +
        `</tbody></table>`)
      continue
    }
    if ((m = line.match(/^\s*[•\-\*]\s+(.*)$/))) {
      flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(m[1])}</li>`); continue
    }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(m[1])}</li>`); continue
    }
    closeList(); para.push(inline(line))
  }
  if (code !== null) out.push(`<pre><code>${code.map(esc).join('\n')}</code></pre>`)   // unclosed fence
  flushPara(); closeList()
  return out.join('\n')
}

// ── the other direction ──────────────────────────────────────────────────────
// HTML → Markdown, for exporting a note or a document as a .md file. The input is not
// arbitrary web HTML: it is what the notes editor and the documenter's MARKUP_RULES emit —
// <section>, h1-h6, p, ul/ol/li (incl. Tiptap task lists), table, pre/code, blockquote, hr,
// and inline strong/em/s/code/a/img.
//
// ponytail: string work, not a DOM — the tests run under bare `node`, which has no DOMParser.
// Lists convert innermost-first so real nesting survives; anything outside the vocabulary above
// is dropped to its text. Swap in turndown if this ever has to eat HTML from the wild.
//
// The dialect is Azure DevOps wiki flavoured, since that is where these files get pasted:
// https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance
// Three of its rules are not the common ones — a hard break is TWO TRAILING SPACES and nothing
// else ("if you press Enter without the two spaces, the published output doesn't include a line
// break"), a break inside a table cell has to be a literal <br/>, and nested lists are indented
// four spaces. All three are handled below; everything else here is plain CommonMark.

const unesc = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')            // last: otherwise &amp;lt; would become <

// Entities are left alone here — htmlToMd unescapes ONCE at the end, so that text written as
// `&amp;lt;` survives as the literal `&lt;` instead of decoding twice into a tag.
// A <br> is parked on a sentinel until after whitespace is collapsed, or the two spaces that
// ARE the break would be squeezed into one. `brk` is what it finally becomes: two-spaces-newline
// in prose, a literal <br/> inside a table cell, which is the only form Azure DevOps takes there.
const BR = '\u0001'
// Inline markup only. Split out from inlineMd because the catch-all at the end of htmlToMd needs
// it too: text sitting in a container this converter doesn't model should still keep its bold and
// its backticks rather than merely losing the tags.
const inlineTags = (h) => (String(h || '')
  .replace(/<br\s*\/?>/gi, BR)
  .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  .replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
  .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
  .replace(/<img\b[^>]*>/gi, (m) => {
    const src = m.match(/\bsrc="([^"]*)"/i)?.[1]
    return src ? `![${m.match(/\balt="([^"]*)"/i)?.[1] || ''}](${src})` : ''
  })
  )

const inlineMd = (h, brk = '  \n') => inlineTags(h)
  .replace(/<[^>]+>/g, '')
  .replace(/[ \t]+/g, ' ')
  .trim()
  .split(BR).join(brk)

// Tags that never justify a line break of their own when they reach the catch-all.
const INLINE = new Set(['span', 'a', 'code', 'strong', 'b', 'em', 'i', 's', 'del', 'ins', 'u',
  'sub', 'sup', 'mark', 'small', 'abbr', 'kbd', 'var', 'samp', 'cite', 'q', 'time', 'font', 'tt', 'label'])

// A row of cells, already inlined. Pipes inside a cell would split it, so they are escaped, and
// a cell that spans lines is folded — a table row IS one line.
const cells = (tr) => [...tr.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
  .map(m => inlineMd(m[2], '<br/>').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '))

function tableMd(inner) {
  const rows = (inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []).map(cells).filter(r => r.length)
  if (!rows.length) return ''
  // Markdown has no headerless table; a body-only one gets a blank header rather than
  // losing its first row to the header slot.
  const headed = /<th[\s>]/i.test(inner)
  const head = headed ? rows.shift() : rows[0].map(() => '')
  const line = (r) => `| ${head.map((_, i) => r[i] || '').join(' | ')} |`
  return `\n${line(head)}\n| ${head.map(() => '---').join(' | ')} |\n${rows.map(line).join('\n')}\n`
}

function listMd(inner, ordered) {
  const items = inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []
  return '\n' + items.map((li, i) => {
    const box = /\bdata-checked="true"/i.test(li) ? '[x] '
      : /\bdata-type="taskItem"/i.test(li) ? '[ ] ' : ''
    // A nested list has already been converted, so it arrives as its own lines: indent it
    // under this item rather than folding it into the item's text.
    const [first, ...rest] = li.replace(/^<li\b[^>]*>/i, '').replace(/<\/li>$/i, '').split('\n')
    const head = (ordered ? `${i + 1}. ` : '- ') + box + inlineMd(first)
    // Four spaces, not two: two is enough under "- " but not under "1. ", and Azure DevOps
    // indents nested lists four in its own examples.
    const tail = rest.map(l => (l.trim() ? '    ' + l : '')).filter(Boolean).join('\n')
    return tail ? `${head}\n${tail}` : head
  }).join('\n') + '\n'
}

export function htmlToMd(html) {
  let s = String(html || '').replace(/<!--[\s\S]*?-->/g, '')

  // Diagrams and code are lifted out first so nothing below rewrites their insides. An <svg>
  // is kept as raw HTML: Markdown allows it, and a placeholder would delete the only thing a
  // diagram section contains.
  const kept = []
  const park = (text) => `\u0000${kept.push(text) - 1}\u0000`
  s = s
    .replace(/<svg[\s\S]*?<\/svg>/gi, (m) => park(`\n${m}\n`))
    .replace(/<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (m, attrs, code) =>
      park(`\n\`\`\`${attrs.match(/language-([\w+#.-]+)/i)?.[1] || ''}\n${unesc(code).replace(/\n$/, '')}\n\`\`\`\n`))
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (m, code) => park(`\n\`\`\`\n${unesc(code).replace(/\n$/, '')}\n\`\`\`\n`))

  // Parked like the code blocks: a finished table can contain a literal <br/> in a cell, and the
  // catch-all tag strip below would eat it. Parked text skips the final unescape, so do it here.
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (m, inner) => park(unesc(tableMd(inner))))

  // Innermost list first — by the time an outer list is matched, its children are plain lines.
  const INNERMOST = /<(ul|ol)\b([^>]*)>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/i
  for (let m; (m = s.match(INNERMOST));) s = s.replace(INNERMOST, listMd(m[3], m[1].toLowerCase() === 'ol'))

  // Definition lists are in the documenter's markup rules and Markdown has no equivalent, so a
  // term/meaning pair becomes one bullet. Without this every tag boundary inside a <dl> reached
  // the catch-all below and the whole block came out one word per line.
  s = s.replace(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi, (m, inner) => {
    const pairs = [...inner.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*(?:<dd\b[^>]*>([\s\S]*?)<\/dd>)?/gi)]
    if (!pairs.length) return ''
    return '\n' + pairs.map(([, dt, dd]) => {
      const term = inlineMd(dt)
      // A term that already carries emphasis is left alone: **a **b** c** nests wrong.
      const lead = !term ? '' : term.includes('**') ? term : `**${term}**`
      const body = inlineMd(String(dd || '').replace(/<\/(p|div|dd)>/gi, ' '))
      return `- ${lead}${lead && body ? ' — ' : ''}${body}`
    }).join('\n') + '\n'
  })

  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => `\n${'#'.repeat(+n)} ${inlineMd(t)}\n`)
    // Each paragraph in the quote stays a paragraph: run them together and "a" + "b" would
    // come out as one word.
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, t) => {
      const text = (t.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [t]).map(inlineMd).filter(Boolean).join('\n\n')
      return `\n${text.split('\n').map(l => `> ${l}`.trimEnd()).join('\n')}\n`
    })
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (m, t) => `\n${inlineMd(t)}\n`)

  // Whatever is left: inline markup is converted in place, a block wrapper becomes a line break,
  // an inline one just goes. Breaking the line on <code> is what turned "(table `x`)" into four
  // lines. Any <br> that got here belongs to one of those containers, so it breaks the line too.
  s = inlineTags(s)
    .replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (m, tag) => (INLINE.has(tag.toLowerCase()) ? '' : '\n'))
    .replace(/<[^>]+>/g, '\n')          // comments-turned-junk and anything not tag-shaped
    .split(BR).join('  \n')

  s = unesc(s).replace(/\u0000(\d+)\u0000/g, (m, i) => kept[+i])

  return s
    // Trailing whitespace goes, EXCEPT a two-space hard break, which is load-bearing here.
    .split('\n').map(l => (/\S {2}$/.test(l) ? l.replace(/\s+$/, '  ') : l.trimEnd())).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n'
}
