// Capture -> Vendasta AI Knowledge (Knowledge API v2: POST {base}/v1/knowledge/list + /v1/knowledge/upsert, OAuth2 scope `knowledge`).
// Env only: VENDASTA_SERVICE_ACCOUNT_JSON, VENDASTA_ACCOUNT_GROUP_ID (or VENDASTA_ACCOUNT_ID), VENDASTA_AI_ASSISTANT_ID (or VENDASTA_CHAT_RECEPTIONIST_ID),
// VENDASTA_KB_WRITE_ENABLED must be "true" to write. Optional VENDASTA_API_BASE. Nothing is logged except status codes.
import dns from 'node:dns/promises'; import net from 'node:net';
import { token } from './vendasta.js';
export const MAX_BYTES = 1_500_000, MAX_TEXT = 100_000, TIMEOUT = 8000, MAX_REDIRECTS = 3;
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const l = ip.toLowerCase(); if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('ff');
}
async function assertPublic(u, lookup) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('bad_url');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('bad_port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('private_address');
}
const BROWSER_HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9',
  'upgrade-insecure-requests': '1', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1' };
// Alternate on 403/429: an honest bot UA (Cloudflare challenges spoofed-Chrome UAs from non-browser TLS but often allows declared bots).
const ALT_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; MyAIValetBot/1.0; +https://myaivalet.getondeets.ai)', accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' };
export async function safeFetchText(url, { lookup = dns.lookup, fetchImpl = fetch, timeout = TIMEOUT, maxBytes = MAX_BYTES, accept = /text\/html|text\/plain|xhtml/ } = {}) {
  let u = new URL(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublic(u, lookup);
    let r = await fetchImpl(u.href, { redirect: 'manual', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeout) });
    if (r.status === 403 || r.status === 429) { try { await r.body?.cancel(); } catch {} // retry once with alternate headers
      r = await fetchImpl(u.href, { redirect: 'manual', headers: ALT_HEADERS, signal: AbortSignal.timeout(timeout) }); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    if (!r.ok) throw new Error('http_' + r.status);
    if (LOGIN_RE.test(u.pathname)) throw new Error('login_redirect');
    const ct = r.headers.get('content-type') || ''; if (!accept.test(ct)) throw new Error('bad_content_type');
    const reader = r.body.getReader(); const chunks = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > maxBytes) { await reader.cancel(); break; } chunks.push(value); }
    return { finalUrl: u.href, html: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('too_many_redirects');
}
const ent = s => s.replace(/&nbsp;/g, ' ').replace(/&dollar;/g, '$').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
export function extract(html, host) {
  const meta = re => { const m = html.match(re); return m ? ent(m[1]).trim() : ''; };
  const name = meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || meta(/<title[^>]*>([^<]+)/i).split(/\s[|\-–—]\s/)[0] || host;
  const desc = meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
  const text = ent(html.replace(/<(script|style|noscript|svg|iframe|template|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { businessName: name.slice(0, 120), description: desc.slice(0, 500), text };
}
export function kbConfig() {
  const e = process.env;
  return { sa: e.VENDASTA_SERVICE_ACCOUNT_JSON, ag: e.VENDASTA_ACCOUNT_GROUP_ID || e.VENDASTA_ACCOUNT_ID, assistant: e.VENDASTA_AI_ASSISTANT_ID || e.VENDASTA_CHAT_RECEPTIONIST_ID,
    extraAssistants: String(e.VENDASTA_EXTRA_ASSISTANT_IDS || '').split(',').map(x => x.trim()).filter(x => /^ASSISTANT-[\w-]+$/.test(x)),
    write: e.VENDASTA_KB_WRITE_ENABLED === 'true', base: e.VENDASTA_API_BASE || 'https://prod.apigateway.co/grpc' };
}

// ---- multi-page crawl: home + ALL same-origin linked pages (safety cap MAX_LINKS), pooled, time-budgeted, ranked by link text/path relevance ----
export const MAX_LINKS = 150, CONCURRENCY = 6, SUB_TIMEOUT = 4000, SUB_MAX_BYTES = 800_000, MIN_PAGE_TEXT = 200, PER_PAGE_TEXT = 15_000, CRAWL_BUDGET = 25_000;
const LOGIN_RE = /\/(log-?in|sign-?in|signup|register|account|my-account|wp-login|wp-admin|auth|sso)(\/|\.|$)/i;
const SKIP_RE = /(thank-?you|thanks|not-?found|\b404\b|log-?in|sign-?in|sign-?up|register|my-?account|\baccount\b|cart|checkout|basket|wp-admin|wp-login|wp-json|privacy|terms|cookie|legal|disclaimer|accessibility|sitemap|\bfeed\b|\/rss|\.xml|\/tag\/|\/author\/|xmlrpc|unsubscribe|careers?-portal)/i;
const FILE_RE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|mp4|mp3|mov|zip|docx?|xlsx?|pptx?|css|js|json|xml|txt|ics)$/i;
const KEYWORDS = [[/listings?|propert(y|ies)|homes?|for[- ]sale|real[- ]estate|inventory|featured|idx|search[- ]homes|rentals?/i, 10],
  [/our[- ]team|team|agents?|realtors?|brokers?|staff|people|leadership|meet/i, 8], [/about|who[- ]we[- ]are|our[- ]story|company/i, 7],
  [/services?|products?|shop|menu|pricing|prices|rates|plans|packages|solutions|what[- ]we[- ]do|offerings?/i, 7],
  [/contact|locations?|hours|visit|directions|find[- ]us/i, 6], [/faq|reviews?|testimonials?|neighborhoods?|communities|areas/i, 4]];
export function scoreLink(text, path) {
  const t = String(text || ''), p = String(path || ''); if (SKIP_RE.test(t) || SKIP_RE.test(p) || FILE_RE.test(p)) return -1;
  let s = 0; for (const [re, w] of KEYWORDS) { if (re.test(t)) s += w; if (re.test(p.replace(/[-_/]/g, ' '))) s += Math.ceil(w / 2); }
  const depth = p.split('/').filter(Boolean).length; if (depth > 3) s -= 3; return s;
}
export const siteRoot = h => { const p = String(h).toLowerCase().replace(/^www\./, '').split('.'); return p.slice(/^(co|com|org|net|gov|ac|edu)$/.test(p.at(-2)) && p.at(-1).length === 2 ? -3 : -2).join('.'); };
const sameSite = (h, base) => siteRoot(h) === siteRoot(base) || /\.idxbroker\.com$/i.test(h); // IDX Broker listing hosts count as the site
export function extractLinks(html, baseUrl, excluded = []) {
  const base = new URL(baseUrl), seen = new Map(); const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const raw = ent(m[1]).trim(); if (/^(mailto:|tel:|javascript:|#|sms:|data:)/i.test(raw) || /\$\{|\{\{|%7B|\/cdn-cgi\//i.test(raw)) continue; // anchors, contact links, JS template placeholders
    let u; try { u = new URL(raw, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, base.hostname)) continue; // same site incl. subdomains (e.g. search.<site> IDX listings)
    if ([...u.searchParams.keys()].length > 1 || u.search.length > 40) continue; // query-heavy
    u.hash = ''; if (u.pathname === '/' || u.pathname === base.pathname) continue;
    const text = ent(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80) || (m[0].match(/(?:title|aria-label)=["']([^"']+)/i)?.[1] || '');
    const score = scoreLink(text, u.pathname); if (score < 0) { if (!excluded.some(e => e.url === u.href)) excluded.push({ url: u.href, reason: FILE_RE.test(u.pathname) ? 'file' : u.pathname.split('/').filter(Boolean).length > 3 ? 'too_deep' : 'noise_url/link_text "' + text.slice(0, 30) + '"' }); continue; }
    const key = u.href.replace(/\/$/, ''); const prev = seen.get(key); if (!prev || prev.score < score) seen.set(key, { url: u.href, text, score });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}
const NOISE_TITLE_RE = /(page not found|not found|\b404\b|thank you|thanks for|log ?in|sign ?in|sign ?up|register|my account|shopping cart|checkout|privacy policy|cookie policy|terms (of|and|&))/i;
export const PRIORITY_SCORE = 6; // listings/team/about/contact/services keep even if dedupe leaves less text
export function dedupeBoilerplate(pages, { minUnique = MIN_PAGE_TEXT, keepPriorityMin = 120, share = 0.5 } = {}) {
  const excluded = []; if (pages.length < 3) return { pages, excluded };
  const norm = l => l.trim().toLowerCase().replace(/\s+/g, ' '); const count = new Map();
  for (const p of pages) for (const l of new Set(p.text.split('\n').map(norm).filter(l => l.length >= 3))) count.set(l, (count.get(l) || 0) + 1);
  const limit = Math.max(2, pages.length * share); const kept = [];
  for (const [i, p] of pages.entries()) {
    if (i === 0) { kept.push(p); continue; } // home keeps shared lines once (phone, address, etc.)
    const text = p.text.split('\n').filter(l => (count.get(norm(l)) || 0) <= limit).join('\n').trim();
    if (text.length >= minUnique || (p.score >= PRIORITY_SCORE && text.length >= keepPriorityMin)) kept.push({ ...p, text });
    else excluded.push({ url: p.url, reason: 'boilerplate_only(' + text.length + ' unique chars)' });
  }
  return { pages: kept, excluded };
}
export async function crawlSite(siteUrl, opts = {}) {
  const t0 = Date.now(); const budget = opts.budget || CRAWL_BUDGET, conc = opts.concurrency || CONCURRENCY;
  const home = await safeFetchText(siteUrl, opts); const host = new URL(home.finalUrl).hostname; const hx = extract(home.html, host);
  let pages = [{ url: home.finalUrl, title: (home.html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').trim(), text: hx.text, score: 1e9, ...(opts.keepHtml ? { html: home.html } : {}) }];
  let candidates = [], excluded = []; try { const all = extractLinks(home.html, home.finalUrl, excluded); candidates = all.slice(0, opts.maxLinks || MAX_LINKS);
    for (const c of all.slice(candidates.length)) excluded.push({ url: c.url, reason: 'over_link_cap' }); } catch {}
  const stats = { found: candidates.length, read: 0, skippedTime: 0, skippedBad: 0, skippedErr: 0 };
  const seenText = new Set([hx.text.slice(0, 300)]); let next = 0; const ex = (url, reason, k = 'skippedBad') => { excluded.push({ url, reason }); stats[k]++; };
  const worker = async () => { while (next < candidates.length) { const c = candidates[next++];
      const left = budget - (Date.now() - t0); if (left < 500) { ex(c.url, 'time_budget', 'skippedTime'); continue; }
      let r; try { r = await safeFetchText(c.url, { ...opts, timeout: Math.min(SUB_TIMEOUT, left), maxBytes: SUB_MAX_BYTES }); }
      catch (e) { const t = /timeout|abort/i.test(e.name + e.message); ex(c.url, t ? 'timeout' : e.message === 'http_404' || e.message === 'http_410' ? 'not_found(' + e.message.slice(5) + ')' : e.message, t && budget - (Date.now() - t0) < 600 ? 'skippedTime' : 'skippedErr'); continue; }
      const fp = new URL(r.finalUrl); if (!sameSite(fp.hostname, host)) { ex(c.url, 'redirect_offsite'); continue; }
      if (LOGIN_RE.test(fp.pathname) || SKIP_RE.test(fp.pathname)) { ex(c.url, 'redirect_to_noise ' + fp.pathname); continue; }
      const title = ent((r.html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').trim());
      if (NOISE_TITLE_RE.test(title)) { ex(c.url, 'noise_title "' + title.slice(0, 60) + '"'); continue; }
      const t = extract(r.html, host).text; if (t.length < MIN_PAGE_TEXT) { ex(c.url, 'tiny_text(' + t.length + ')'); continue; }
      if (seenText.has(t.slice(0, 300))) { ex(c.url, 'duplicate'); continue; } seenText.add(t.slice(0, 300)); stats.read++;
      pages.push({ url: r.finalUrl, title: title || c.text, text: t, score: c.score, ...(opts.keepHtml ? { html: r.html } : {}) }); } };
  await Promise.all(Array.from({ length: Math.min(conc, candidates.length) }, worker));
  pages.sort((a, b) => b.score - a.score); // priority order (home first) so truncation drops least important pages
  const d = dedupeBoilerplate(pages); pages = d.pages; excluded.push(...d.excluded); stats.kept = pages.length; stats.excluded = excluded.length;
  if (!opts.quiet) for (const e of excluded) console.log('KB_INGEST_EXCLUDED', e.url, e.reason);
  stats.ms = Date.now() - t0; return { home, host, x: hx, pages, stats, excluded };
}
export function combinePages(pages, max = MAX_TEXT) {
  let out = ''; for (const [i, p] of pages.entries()) {
    const remaining = max - out.length; if (remaining < 300) break;
    const body = p.text.slice(0, i === 0 ? 30_000 : PER_PAGE_TEXT);
    out += `\n\n=== Page ${i + 1}: ${ent(p.title || '').slice(0, 150)} — ${p.url} ===\n${body}`.slice(0, remaining);
  } return out.trim();
}
export async function ingestSite(siteUrl, opts = {}) {
  const t0 = Date.now(); const c = kbConfig();
  if (!c.sa || !c.ag || !c.assistant) { console.log('KB_INGEST_SKIPPED not_configured'); return { status: 'not_configured' }; }
  if (!c.write) { console.log('KB_INGEST_SKIPPED write_disabled'); return { status: 'write_disabled' }; }
  if (!/^AG-[A-Z0-9]+$/.test(c.ag) || !/^ASSISTANT-[\w-]+$/.test(c.assistant)) { console.error('KB_INGEST_BAD_IDS'); return { status: 'bad_config' }; }
  let page, host, x, pages, stats = { found: 0, read: 0, skippedTime: 0, skippedBad: 0, skippedErr: 0 };
  try { const cr = opts.crawled || await crawlSite(siteUrl, opts); /* opts.crawled: reuse a crawl already done (before-after snapshot) */ page = cr.home; host = cr.host; x = cr.x; pages = cr.pages; stats = cr.stats; }
  catch (e) { if (opts.noFallback || opts.crawlMode !== 'single') { console.error('KB_INGEST_CRAWL_FAILED (no homepage-only fallback: full-site HARD RULE Oct 16 2026)', e.message); return { status: 'crawl_failed', reason: e.message }; }
    console.error('KB_INGEST_CRAWL_FALLBACK explicit crawlMode=single', e.message); // single-page only on explicit override
    page = await safeFetchText(siteUrl, opts); host = new URL(page.finalUrl).hostname; x = extract(page.html, host); pages = [{ url: page.finalUrl, title: '', text: x.text }]; }
  if (x.text.length < 50 && pages.length < 2) return { status: 'no_text' };
  const name = `Prospect – ${x.businessName} (${host})`.slice(0, 500);
  const head = `Business: ${x.businessName}\nWebsite: ${page.finalUrl}\nPages read: ${pages.length}\n${x.description ? 'Summary: ' + x.description + '\n' : ''}`;
  const content = (head + '\n' + (pages.length > 1 ? combinePages(pages, MAX_TEXT - head.length - 2) : x.text)).slice(0, MAX_TEXT);
  const tok = await token(); const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
  const call = async (path, body) => { const r = await fetch(c.base + path, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!r.ok) { const e = new Error(path + ' ' + r.status); e.code = r.status; throw e; } return r.json().catch(() => ({})); };
  let existing = null; // reuse a source with the same name so repeat captures update instead of duplicating
  try { const l = await call('/v1/knowledge/list', { accountGroupId: c.ag, pagingOptions: { pageSize: 100 } });
    existing = (l.knowledgeSources || []).find(k => k.name === name)?.knowledgeSourceId || null; } catch (e) { if (e.code === 429) return { status: 'rate_limited' }; }
  try {
    const j = await call('/v1/knowledge/upsert', { accountGroupId: c.ag, assistantId: c.assistant, name,
      description: `Auto-added from MyAiValet capture of ${page.finalUrl} on ${new Date().toISOString()}`.slice(0, 2000),
      content: { text: { text: content } }, ...(existing ? { knowledgeSourceId: existing } : {}) });
    const ks = j.knowledgeSourceId || existing || null; const linked = [c.assistant];
    for (const a of c.extraAssistants.filter(a => a !== c.assistant)) { // links are additive: re-upsert same source with another assistantId
      try { await call('/v1/knowledge/upsert', { accountGroupId: c.ag, assistantId: a, knowledgeSourceId: ks, name, content: { text: { text: content } } }); linked.push(a); }
      catch (e) { console.error('KB_INGEST_LINK_FAILED', a, e.code || e.message); } }
    console.log('KB_INGEST_OK', existing ? 'updated' : 'created', ks, 'linked=' + linked.join(','), 'pages=' + pages.length, 'found=' + stats.found, 'skipped_time=' + stats.skippedTime, 'skipped_other=' + (stats.skippedBad + stats.skippedErr), 'chars=' + content.length, 'ms=' + (Date.now() - t0), 'host=' + host);
    return { status: 'synced', pages: pages.map(p => p.url), stats, chars: content.length, knowledgeSourceId: ks, updated: !!existing, name, linked };
  } catch (e) { console.error('KB_INGEST_FAILED', e.code || e.message); return { status: e.code === 429 ? 'rate_limited' : 'error' }; }
}
