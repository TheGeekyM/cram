import React from 'react'
import { mdToHtml } from '../screens/markdownLite.js'

// Model output is markdown; render it as HTML but strip anything executable first.
// ponytail: template + attribute sweep, not a full sanitizer library — the input is
// our own prompt's output, not user-supplied HTML.
function sanitize(html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html || ''
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base').forEach(n => n.remove())
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase()
      if (n.startsWith('on') || (['href', 'src'].includes(n) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
    }
  })
  // Direction per block, not per answer, and any Arabic outside code makes a block RTL: a
  // technical Arabic line can hold more Latin (request, TTL, closure) than Arabic words.
  tpl.content.querySelectorAll('p,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,td,th').forEach(el => {
    const c = el.cloneNode(true)
    c.querySelectorAll('code,pre').forEach(n => n.remove())
    if (/[A-Za-z\u0600-\u06FF]/.test(c.textContent)) el.dir = /[\u0600-\u06FF]/.test(c.textContent) ? 'rtl' : 'ltr'
  })
  return tpl.innerHTML
}

// onCite(page): page citations like (p. 42) or (ص 42) become links that call it
export default function Markdown({ text, className = '', onCite }) {
  if (!text?.trim()) return null
  // Each line of a paragraph becomes its own <p> so it gets its own direction; .br drops the gap.
  let html = sanitize(mdToHtml(text).replaceAll('<br>', '</p><p class="br">'))
  if (onCite) html = html.replace(/\((?:p|pp|page|ص|صفحة)\.?\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\)/gi, (m, n) => `<a href="#" data-page="${n}" class="text-accent hover:underline">${m}</a>`)
  return (
    <div
      className={`kb-rich text-sm text-gray-300 leading-relaxed ${className}`}
      onClick={onCite ? e => { const a = e.target.closest?.('[data-page]'); if (a) { e.preventDefault(); onCite(+a.dataset.page) } } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
