// Full-site "before" crawl: BFS over ALL same-site HTML pages (+ sitemap.xml / robots.txt sitemaps), no page-count limit.
// Resumable: each invocation works until a time deadline, writes every captured page to Blob immediately, and saves job state
// (queue/visited) to before-after/<domain>/<ts>/state.json. Call again with {job} until status === 'complete'.
// Safety guards only (do not truncate normal small-business sites): per-page byte cap, per-fetch timeout, HARD_MAX_PAGES runaway guard.
// HARD RULE (Laura Wagner, Oct 16 2026): whenever MyAiValet adds a prospect site to the Vendasta knowledge base it ALWAYS
// does a FULL-SITE crawl (every same-domain page reachable by internal links + sitemap.xml / robots.txt sitemaps), never homepage-only.
// The only exception is an explicit override: crawlMode:'single' passed on purpose. Page caps are runaway safety guards only and can
// never be lowered below DEFAULT_MAX_PAGES unless crawlMode:'single' is explicit. Do not change this default without Laura's OK.
import { put, get } from '@vercel/blob';
import { safeFetchText, extract, siteRoot } from './kb-ingest.js';
export const HARD_MAX_PAGES = 5000, DEFAULT_MAX_PAGES = 2000, KB_CHUNK_CHARS = 100_000, KB_FULL_MAX = 4_000_000, CONC = 4, FETCH_TIMEOUT = 8000, PAGE_MAX_BYTES = 1_500_000, SITEMAP_MAX = 20;
const ASSET_RE = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|m4v|webm|mp3|wav|mov|avi|zip|rar|gz|7z|docx?|xlsx?|pptx?|csv|css|js|mjs|json|xml|rss|atom|txt|ics|woff2?|ttf|eot|otf|map|exe|dmg|apk)$/i;
const NOISE_PATH_RE = /\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|cdn-cgi|cart|checkout|basket|my-?account|log-?in|sign-?in|sign-?up|register|logout|auth|sso|feed|comments\/feed)(\/|\.|$)/i;
const sameSite = (h, base) => siteRoot(h) === siteRoot(base);
const ent = s => s.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
// Normalize: http(s) only, same site, drop hash AND query (query-string duplicates), collapse //, strip trailing slash, drop index.html.
export function normalizeUrl(raw, base, rootHost) {
  raw = ent(String(raw || '').trim()); if (!raw || /^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(raw) || /\$\{|\{\{|%7B/i.test(raw)) return null;
  let u; try { u = new URL(raw, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, rootHost)) return null;
  u.hash = ''; u.search = ''; u.hostname = u.hostname.toLowerCase(); u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/index\.(html?|php)$/i, '/');
  if (ASSET_RE.test(u.pathname) || NOISE_PATH_RE.test(u.pathname)) return { skip: true, url: u.href, reason: ASSET_RE.test(u.pathname) ? 'asset' : 'noise_path' };
  if (/\/(www\.)?[a-z0-9-]+\.(com|net|org|io|co|us|me|tv|ly|be|gl)(\/|$)/i.test(u.pathname)) return { skip: true, url: u.href, reason: 'broken_relative_external_link' }; // e.g. href="linkedin.com/in/x"
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return { url: u.href, key: u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname).toLowerCase() };
}
export function hrefs(html) { const out = []; const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi; let m; while ((m = re.exec(html))) out.push(m[1]); return out; }
export function sitemapLocs(xml) { const out = []; const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi; let m; while ((m = re.exec(xml))) out.push(ent(m[1])); return out; }
const title = html => (html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').replace(/&amp;/g, '&').trim().slice(0, 200);
export async function readBlob(path) { const r = await get(path, { access: 'private', useCache: false }); if (!r || r.statusCode !== 200 || !r.stream) throw new Error('state_missing'); return await new Response(r.stream).text(); }
const O = (ct, overwrite = false) => ({ access: 'private', contentType: ct, addRandomSuffix: false, ...(overwrite ? { allowOverwrite: true } : {}) });
function addUrl(st, raw, base, via) {
  const n = normalizeUrl(raw, base, st.rootHost); if (!n) return;
  if (n.skip) { if (!st.skippedKeys[n.url]) { st.skippedKeys[n.url] = 1; st.skipped.push({ url: n.url, reason: n.reason }); } return; }
  if (st.seen[n.key]) return; st.seen[n.key] = 1; st.found++; st.queue.push({ url: n.url, via });
}
async function discoverSitemaps(st, opts) {
  const origin = new URL(st.finalUrl).origin; const maps = [origin + '/sitemap.xml', origin + '/sitemap_index.xml']; const done = new Set(); let urls = 0;
  try { const rb = await safeFetchText(origin + '/robots.txt', { ...opts, timeout: 5000, maxBytes: 200_000, accept: /text\/plain|text\/html/ });
    for (const m of rb.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)) maps.unshift(m[1]); } catch {}
  while (maps.length && done.size < SITEMAP_MAX) { const sm = maps.shift(); if (done.has(sm)) continue; done.add(sm);
    try { const r = await safeFetchText(sm, { ...opts, timeout: 6000, maxBytes: 5_000_000, accept: /xml|text\/plain|text\/html/ });
      if (!/<(urlset|sitemapindex)\b/i.test(r.html)) continue;
      for (const loc of sitemapLocs(r.html)) { if (/<sitemapindex\b/i.test(r.html) || /\.xml(\.gz)?$/i.test(new URL(loc, sm).pathname)) { if (!/\.gz$/i.test(loc)) maps.push(loc); } else { addUrl(st, loc, sm, 'sitemap'); urls++; } }
      st.sitemaps.push({ url: sm, ok: true });
    } catch (e) { st.sitemaps.push({ url: sm, ok: false, reason: e.message }); } }
  return urls;
}
// Lines repeated on many pages (nav/footer) are kept once on the home page; other pages keep their unique text. Every page stays in KB.
function pageText(st, html) { const t = extract(html, st.rootHost).text; if (!st.homeLines) return t;
  return t.split('\n').filter(l => { const k = l.trim().toLowerCase(); return k.length > 120 || !st.homeLines[k]; }).join('\n').trim() || t; }
// Crawl mode: 'full' is the hard default. Anything other than an explicit 'single' resolves to 'full'.
export const CRAWL_MODE_DEFAULT = 'full';
export function resolveCrawlMode(v) { return String(v ?? '').trim().toLowerCase() === 'single' ? 'single' : CRAWL_MODE_DEFAULT; }
export function resolveMaxPages(req, env = process.env, crawlMode = CRAWL_MODE_DEFAULT) {
  if (resolveCrawlMode(crawlMode) === 'single') return { cap: 1, source: 'override:crawlMode=single', clamped: false };
  // Full mode: request/env may RAISE the cap (up to HARD_MAX_PAGES) but never lower it below DEFAULT_MAX_PAGES (rule above).
  const pick = (v, src) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? { cap: Math.min(Math.max(n, DEFAULT_MAX_PAGES), HARD_MAX_PAGES), source: n < DEFAULT_MAX_PAGES ? src + ':raised_to_full_default' : src, clamped: n > HARD_MAX_PAGES } : null; };
  return pick(req, 'request') || pick(env.CRAWL_MAX_PAGES, 'env:CRAWL_MAX_PAGES') || { cap: DEFAULT_MAX_PAGES, source: 'default', clamped: false };
}
export async function startJob(siteUrl, { opts = {}, mode = 'live', putImpl = put, maxPages, crawlMode } = {}) {
  const startedAt = new Date().toISOString(); const home = await safeFetchText(siteUrl, { ...opts, timeout: FETCH_TIMEOUT, maxBytes: PAGE_MAX_BYTES });
  const host = new URL(home.finalUrl).hostname; const domain = host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
  const prefix = `before-after/${domain}/${startedAt.replace(/[:.]/g, '-')}/`; const hx = extract(home.html, host);
  const st = { v: 2, prefix, mode, requestedUrl: siteUrl, finalUrl: home.finalUrl, rootHost: host, domain, businessName: hx.businessName, description: hx.description,
    startedAt, invocations: 0, found: 0, queue: [], seen: {}, skippedKeys: {}, skipped: [], errors: [], pages: [], parts: [], sitemaps: [], status: 'running', activeMs: 0, captured: {} };
  st.crawlMode = resolveCrawlMode(crawlMode); const mp = resolveMaxPages(maxPages, process.env, st.crawlMode); st.maxPages = mp.cap; st.maxPagesSource = mp.source; st.maxPagesClamped = mp.clamped;
  st.homeLines = {}; for (const l of hx.text.split('\n')) { const k = l.trim().toLowerCase(); if (k.length >= 3 && k.length <= 120) st.homeLines[k] = 1; }
  const hn = normalizeUrl(home.finalUrl, home.finalUrl, host); st.seen[hn.key] = 1; st.captured[hn.key] = 1; st.found = 1;
  st.pendingHome = { url: home.finalUrl, html: home.html, text: hx.text, title: title(home.html) };
  if (st.crawlMode === 'single') { st.sitemapUrls = 0; return st; } // explicit override only
  for (const h of hrefs(home.html)) addUrl(st, h, home.finalUrl, home.finalUrl);
  st.sitemapUrls = await discoverSitemaps(st, opts);
  return st;
}
export async function runJob(st, { deadlineMs = 40_000, opts = {}, putImpl = put } = {}) {
  const t0 = Date.now(); st.invocations++; const part = []; const writes = []; let writeErr = null;
  const save = (p, i) => { const n = String(i).padStart(4, '0'); const files = { html: st.prefix + `pages/${n}.html`, text: st.prefix + `pages/${n}.txt` };
    for (const w of [putImpl(files.html, p.html || ' ', O('text/html; charset=utf-8')), putImpl(files.text, p.text || ' ', O('text/plain; charset=utf-8'))]) { w.catch(e => { writeErr ||= e; }); writes.push(w); }
    st.pages.push({ n: i, url: p.url, title: p.title, chars: p.text.length, htmlBytes: Buffer.byteLength(p.html), ...files });
    part.push(`\n\n=== Page ${i}: ${p.title || ''} — ${p.url} ===\n${p.text}`); };
  if (st.pendingHome) { save(st.pendingHome, 1); delete st.pendingHome; }
  const worker = async () => { while (st.queue.length && Date.now() - t0 < deadlineMs && !writeErr) {
      if (st.pages.length >= (st.maxPages || DEFAULT_MAX_PAGES)) { st.hardCapHit = true; break; }
      const c = st.queue.shift(); let r;
      try { r = await safeFetchText(c.url, { ...opts, timeout: FETCH_TIMEOUT, maxBytes: PAGE_MAX_BYTES }); }
      catch (e) { st.errors.push({ url: c.url, reason: e.name === 'TimeoutError' ? 'timeout' : e.message }); continue; }
      const f = normalizeUrl(r.finalUrl, r.finalUrl, st.rootHost);
      if (!f || f.skip) { st.errors.push({ url: c.url, reason: 'redirect_offsite_or_noise ' + r.finalUrl }); continue; }
      if (st.captured[f.key]) { st.skipped.push({ url: c.url, reason: 'redirect_duplicate ' + r.finalUrl }); continue; }
      if (st.pages.length >= (st.maxPages || DEFAULT_MAX_PAGES)) { st.hardCapHit = true; st.queue.unshift(c); break; }
      st.captured[f.key] = 1; st.seen[f.key] = 1;
      for (const h of hrefs(r.html)) addUrl(st, h, r.finalUrl, c.url);
      const text = pageText(st, r.html); save({ url: r.finalUrl, html: r.html, text, title: title(r.html) }, st.pages.length + 1);
      if (opts.politeMs) await new Promise(z => setTimeout(z, opts.politeMs)); } };
  await Promise.all(Array.from({ length: CONC }, worker)); const wr = await Promise.allSettled(writes); const bad = wr.find(x => x.status === 'rejected'); if (bad) throw bad.reason;
  if (part.length) { const pp = st.prefix + `kb-parts/${String(st.parts.length + 1).padStart(3, '0')}.txt`; await putImpl(pp, part.join(''), O('text/plain; charset=utf-8')); st.parts.push(pp); }
  st.activeMs += Date.now() - t0;
  if (!st.queue.length || st.hardCapHit) st.status = 'finishing';
  return st;
}
export async function saveState(st, putImpl = put) { await putImpl(st.prefix + 'state.json', JSON.stringify(st), O('application/json', true)); }
export async function loadState(prefix) { if (!/^before-after\/[a-z0-9.-]+\/[0-9TZ-]+\/$/.test(prefix)) throw new Error('bad_job'); return JSON.parse(await readBlob(prefix + 'state.json')); }
// Finalize in resumable steps bounded by deadlineMs. Writes kb/NNN.txt chunks (each <= KB_CHUNK_CHARS, split on page boundaries),
// then kb.txt (full text if <= KB_FULL_MAX, else an index of chunk paths), screenshot, manifest. Returns { done, manifest? }.
export function splitSegments(text) { return text.split(/(?=\n\n=== Page \d+: )/).filter(Boolean); }
export async function finishStep(st, { putImpl = put, screenshot, readImpl = readBlob, deadlineMs = 30_000 } = {}) {
  const t0 = Date.now(); const left = () => deadlineMs - (Date.now() - t0);
  const f = st.fin ||= { phase: 'chunks', part: 0, cur: '', chunks: [], chars: 0, pagesInKb: 0, steps: 0 }; f.steps++;
  const head = `Business: ${st.businessName}\nWebsite: ${st.finalUrl}\nPages read: ${st.pages.length}\n${st.description ? 'Summary: ' + st.description + '\n' : ''}\n`;
  const flush = async () => { if (!f.cur) return; const path = st.prefix + `kb/${String(f.chunks.length + 1).padStart(3, '0')}.txt`;
    await putImpl(path, f.cur, O('text/plain; charset=utf-8', true)); if (!f.siteText) f.siteText = f.cur.slice(0, 30000); f.chunks.push({ path, chars: f.cur.length, preview: f.cur.slice(0, 2000) }); f.chars += f.cur.length; f.cur = ''; };
  const add = async seg => { if (/^\n\n=== Page \d+: /.test(seg)) f.pagesInKb++;
    while (seg.length) { if (f.cur.length + seg.length <= KB_CHUNK_CHARS) { f.cur += seg; return; }
      if (f.cur) { await flush(); continue; } f.cur = seg.slice(0, KB_CHUNK_CHARS); seg = seg.slice(KB_CHUNK_CHARS); await flush(); } };
  if (f.phase === 'chunks') { if (f.part === 0 && !f.chunks.length && !f.cur) f.cur = head;
    while (f.part < st.parts.length) { if (left() < 4000) return { done: false };
      for (const seg of splitSegments(await readImpl(st.parts[f.part]))) await add(seg); f.part++; }
    await flush(); f.phase = 'kbtxt'; f.kbParts = 0; }
  if (f.phase === 'kbtxt') { if (f.chars <= KB_FULL_MAX) { // full kb.txt, built only from <=4MB, read back in bounded steps
      let acc = f.kbAcc || ''; while (f.kbParts < f.chunks.length) { if (left() < 4000) { f.kbAcc = acc; return { done: false }; } acc += await readImpl(f.chunks[f.kbParts].path); f.kbParts++; }
      await putImpl(st.prefix + 'kb.txt', acc, O('text/plain; charset=utf-8', true)); delete f.kbAcc; f.kbFull = true;
    } else { await putImpl(st.prefix + 'kb.txt', head + `KB too large for one file (${f.chars} chars); see ${f.chunks.length} chunk files:\n` + f.chunks.map(c => c.path).join('\n') + '\n', O('text/plain; charset=utf-8', true)); f.kbFull = false; }
    f.phase = 'shot'; }
  if (f.phase === 'shot') { if (screenshot && left() < 12000) return { done: false };
    const shot = screenshot ? await screenshot(st.finalUrl) : { ok: false, reason: 'not_requested' }; f.shot = { ok: false, provider: 'thum.io', reason: shot.reason };
    if (shot.ok) { const ext = shot.contentType.includes('png') ? 'png' : 'jpg'; await putImpl(st.prefix + 'screenshot.' + ext, shot.buf, O(shot.contentType, true)); f.shot = { ok: true, provider: 'thum.io', path: st.prefix + 'screenshot.' + ext, bytes: shot.buf.length }; }
    f.phase = 'manifest'; }
  const capHit = !!st.hardCapHit;
  const manifest = { kind: 'myaivalet-before-snapshot', version: 3, crawl: 'full-site-bfs', mode: st.mode, requestedUrl: st.requestedUrl, finalUrl: st.finalUrl, domain: st.domain,
    businessName: st.businessName, description: st.description, crawlStartedAt: st.startedAt, snapshotCompletedAt: new Date().toISOString(), invocations: st.invocations, finalizeSteps: f.steps, activeCrawlMs: st.activeMs,
    pages_found: st.found, pages_captured: st.pages.length, pages_in_kb: f.pagesInKb, pages_failed: st.errors.length,
    crawl_mode: st.crawlMode || CRAWL_MODE_DEFAULT, page_cap: { max_pages: st.maxPages || DEFAULT_MAX_PAGES, source: st.maxPagesSource || 'default', clamped_to_hard_max: !!st.maxPagesClamped, hard_max: HARD_MAX_PAGES, hit: capHit, not_captured_queued: capHit ? st.queue.length : 0 },
    hard_cap_hit: capHit, hard_cap: st.maxPages || DEFAULT_MAX_PAGES,
    sitemaps: st.sitemaps, sitemap_urls: st.sitemapUrls, pages: st.pages, failed: st.errors, skipped: st.skipped,
    kb: { path: st.prefix + 'kb.txt', full_text_in_kb_txt: !!f.kbFull, chars: f.chars, chunk_max_chars: KB_CHUNK_CHARS, chunks: f.chunks.map(c => ({ path: c.path, chars: c.chars })), parts: st.parts }, screenshot: f.shot };
  await putImpl(st.prefix + 'manifest.json', JSON.stringify(manifest, null, 2), O('application/json', true));
  st.queue = []; st.seen = {}; st.captured = {}; // shrink state after completion
  st.status = 'complete'; console.log('BEFORE_SNAPSHOT_FULL_OK', st.prefix, 'found=' + st.found, 'captured=' + st.pages.length, 'chunks=' + f.chunks.length, 'cap=' + manifest.page_cap.max_pages + (capHit ? ' HIT' : ''), 'inv=' + st.invocations);
  return { done: true, manifest };
}
// Unbounded convenience wrapper (tests / small sites).
export async function finishJob(st, o = {}) { let r; do r = await finishStep(st, { ...o, deadlineMs: 1e12 }); while (!r.done); return { manifest: r.manifest, chunks: st.fin.chunks }; }
