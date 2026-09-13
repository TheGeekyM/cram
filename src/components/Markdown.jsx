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
  return tpl.innerHTML
}

// onCite(page): page citations like (p. 42) or (ص 42) become links that call it
export default function Markdown({ text, className = '', onCite }) {
  if (!text?.trim()) return null
  let html = sanitize(mdToHtml(text))
  if (onCite) html = html.replace(/\((?:p|pp|page|ص|صفحة)\.?\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\)/gi, (m, n) => `<a href="#" data-page="${n}" class="text-accent hover:underline">${m}</a>`)
  return (
    <div
      className={`kb-rich text-sm text-gray-300 leading-relaxed ${className}`}
      onClick={onCite ? e => { const a = e.target.closest?.('[data-page]'); if (a) { e.preventDefault(); onCite(+a.dataset.page) } } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
