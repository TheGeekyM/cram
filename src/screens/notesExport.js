// A note as a document you can hand to someone: one self-contained HTML file, or that
// same file printed to PDF by the main process. Nothing is fetched at open time — the
// styles are inlined here, because an exported file has no app around it.
//
// The look follows the Read view (see .nt-page in index.css), rebuilt for paper: white
// ground, light-theme ink, and page-break rules so a table or a diagram is never sliced
// in half. ponytail: the CSS is duplicated rather than shared — .nt-page is written in
// theme tokens that only exist inside the app. Keep the two in step by eye.

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 28px 32px 48px; max-width: 190mm; background: #fff;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
    font-size: 11.5pt; line-height: 1.7; color: #1f2937;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .doc-head { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 28px; }
  .doc-head h1 {
    margin: 0; font-size: 20pt; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em;
    color: #111827; font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .doc-meta {
    margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8pt; letter-spacing: 0.09em; text-transform: uppercase; color: #6c7480;
  }

  /* An h1 inside the body means a second document was appended (several team reports exported as
     one file) — the title of the first lives in .doc-head, so this only ever opens a new one. */
  h1 {
    font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 17pt; font-weight: 700; color: #111827; letter-spacing: -0.01em;
    margin: 0 0 22px; padding-bottom: 10px; border-bottom: 2px solid #111827;
    break-before: page; page-break-before: always;
    break-after: avoid; page-break-after: avoid;
  }

  h2 {
    display: flex; align-items: center; gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em;
    color: #111827; margin: 30px 0 12px; padding-left: 9px;
    border-left: 2px solid #c2451f;
    break-after: avoid; page-break-after: avoid;
  }
  h2::after { content: ''; flex: 1; height: 1px; background: #dcdfe4; }
  h3 {
    font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt; font-weight: 600; color: #111827; margin: 20px 0 6px;
    break-after: avoid; page-break-after: avoid;
  }
  h2 + h3 { margin-top: 10px; }
  p { margin: 9px 0; }
  strong { color: #111827; font-weight: 600; }
  ul, ol { padding-inline-start: 20px; margin: 9px 0; }
  :is(ul, ol)[style*="text-align"] { list-style-position: inside; }
  :is(ul, ol)[style*="text-align"] > li > p:first-child { display: inline; }
  li { margin: 4px 0; }
  li::marker { color: #c2451f; }
  blockquote { border-inline-start: 2px solid #dcdfe4; padding-inline-start: 14px; margin: 14px 0; color: #4b5563; font-style: italic; }
  hr { border: 0; border-top: 1px solid #dcdfe4; margin: 24px 0; }

  /* A coloured label opening a paragraph is a callout; the tint comes from its own colour. */
  p > span[style*="color"]:first-child {
    display: inline-block; background: color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 4px; padding: 0.05em 0.5em; margin-right: 0.35em;
    font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  }

  table {
    border-collapse: collapse; width: 100%; margin: 14px 0;
    font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 9pt;
    line-height: 1.5; break-inside: avoid; page-break-inside: avoid;
  }
  th {
    text-align: start; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.11em;
    color: #6c7480; padding: 0 9px 6px; border-bottom: 1px solid #9ca3af;
  }
  td { padding: 7px 9px; vertical-align: top; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f6f7f9; }
  td:first-child { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5pt; color: #111827; }
  table p { margin: 0; }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em;
    background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 3px; padding: 0.05em 0.3em;
  }
  pre {
    background: #f8f9fb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px;
    margin: 14px 0; font-size: 8.5pt; line-height: 1.5; overflow-x: auto;
    white-space: pre-wrap;              /* a wide diagram wraps rather than falling off the page */
    break-inside: avoid; page-break-inside: avoid;
  }
  pre code { background: none; border: 0; padding: 0; font-size: inherit; }
`

// `date` is passed in rather than read here, so the same input always produces the same file.
export function buildExportHtml({ title, body, date = '' }) {
  const name = String(title || '').trim() || 'Untitled'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="doc-head">
  <h1>${esc(name)}</h1>
  ${date ? `<div class="doc-meta">${esc(date)}</div>` : ''}
</div>
${body || ''}
</body>
</html>`
}

// "Analysis: #2323, #3232 — Bank validation" → "Analysis-2323-3232-Bank-validation"
export function exportFileName(title) {
  const base = String(title || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return (base || 'note').slice(0, 80)
}
