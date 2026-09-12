// Verify learning-resource links before showing them. A link survives only if its host confirms it exists,
// and its displayed title comes from that host, not from the model.
// ponytail: existence only. Relevance comes from the web search plus the real title shown to the learner.
const get = (url, ms = 8000) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0 (Cram link check)' } });
const yt = u => /(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname);
const gh = u => u.hostname === 'github.com' && u.pathname.split('/').filter(Boolean).length >= 2;

async function check(r) {
  let u; try { u = new URL(r.url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  try {
    if (yt(u)) { // oEmbed answers 200 with the real title only for public, existing videos and playlists
      const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`); if (!res.ok) return null;
      const o = await res.json(); return { ...r, url: u.href, kind: u.searchParams.has('list') && !u.searchParams.has('v') ? 'playlist' : 'video', title: o.title, source: o.author_name };
    }
    if (gh(u)) { // ponytail: unauthenticated GitHub API, 60 calls/hour per IP; fine for one report, add a token if reports get frequent
      const [owner, repo] = u.pathname.split('/').filter(Boolean); const res = await get(`https://api.github.com/repos/${owner}/${repo}`); if (!res.ok) return null;
      const o = await res.json(); if (o.private || o.archived && !o.stargazers_count) return null;
      return { ...r, url: o.html_url, kind: 'repo', title: o.full_name, source: o.description || '', stars: o.stargazers_count };
    }
    const res = await get(u.href); if (!res.ok) return null; // other pages: a 200 after redirects is the honest ceiling
    const html = (await res.text()).slice(0, 200000); const t = html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)?.[1]?.trim();
    if (/\b(404|not found|page not found)\b/i.test(t || '')) return null; // soft 404 pages
    return { ...r, url: res.url || u.href, title: t ? t.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"') : r.title, source: new URL(res.url || u.href).hostname.replace(/^www\./, '') };
  } catch { return null; }
}
// dedupe by URL, check in parallel, keep order
exports.verify = async list => { const seen = new Set(); const uniq = (list || []).filter(r => r?.url && !seen.has(r.url) && seen.add(r.url)); return (await Promise.all(uniq.map(check))).filter(Boolean); };

if (require.main === module) (async () => {
  const assert = require('assert');
  const out = await exports.verify([
    { kind: 'video', title: 'model says real', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { kind: 'video', title: 'made up video', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { kind: 'playlist', title: 'real playlist', url: 'https://www.youtube.com/playlist?list=PLBlnK6fEyqRgp46KUv4ZY69yXmpwKOIev' },
    { kind: 'playlist', title: 'made up playlist', url: 'https://www.youtube.com/playlist?list=PLnotarealplaylist123' },
    { kind: 'repo', title: 'real repo', url: 'https://github.com/jwasham/coding-interview-university' },
    { kind: 'repo', title: 'made up repo', url: 'https://github.com/jwasham/not-a-real-repo-xyz' },
    { kind: 'quiz', title: 'real quiz', url: 'https://www.w3schools.com/js/js_quiz.asp' },
    { kind: 'quiz', title: 'dead page', url: 'https://www.w3schools.com/js/this_quiz_does_not_exist_123.asp' },
    { kind: 'article', title: 'bad url', url: 'not a url' },
    { kind: 'quiz', title: 'duplicate', url: 'https://www.w3schools.com/js/js_quiz.asp' },
  ]);
  for (const r of out) console.log(r.kind.padEnd(8), '|', r.title.slice(0, 60), '|', r.source?.slice(0, 30));
  assert.deepStrictEqual(out.map(r => r.url.replace(/\/$/, '')), ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/playlist?list=PLBlnK6fEyqRgp46KUv4ZY69yXmpwKOIev', 'https://github.com/jwasham/coding-interview-university', 'https://www.w3schools.com/js/js_quiz.asp']);
  assert.ok(out[0].title.startsWith('Rick Astley'), 'title must come from YouTube, not the model');
  console.log('linkcheck ok');
})();
