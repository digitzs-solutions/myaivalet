// Goal #1 capture: visitor page URL -> this route -> Zapier Catch Hook (env ZAPIER_CAPTURE_WEBHOOK_URL) FIRST -> respond -> full crawl + Vendasta KB sources.
import { randomUUID } from 'node:crypto';
import { startCaptureJob } from '../lib/capturejob.js'; import { pushTo800Logged, businessName } from '../lib/eight00.js'; import { isDryRun, dryRunCrawl, vendastaPlan } from '../lib/dryrun.js';
export const config = { maxDuration: 60 };
let waitUntil = p => { p.catch(() => {}); }; try { ({ waitUntil } = await import('@vercel/functions')); } catch {}
const s = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
export function cleanUrl(v) {
  let raw = s(v, 1000); if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  try { const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || u.username || u.password) return '';
    return u.href; } catch { return ''; }
}
const num = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const dec = v => { try { return s(decodeURIComponent(String(v ?? '')), 100); } catch { return s(v, 100); } };
export function geoFrom(body, h) {
  const lat = num(body.lat, -90, 90), lng = num(body.lng, -180, 180);
  if (lat !== null && lng !== null) { const acc = num(body.accuracy, 0, 1e7);
    return { geo_lat: lat, geo_lng: lng, geo_accuracy_m: acc === null ? '' : Math.round(acc), geo_source: 'browser', geo_city: dec(h['x-vercel-ip-city']), geo_region: s(h['x-vercel-ip-country-region'], 10), geo_country: s(h['x-vercel-ip-country'], 4) }; }
  const ilat = num(h['x-vercel-ip-latitude'], -90, 90), ilng = num(h['x-vercel-ip-longitude'], -180, 180);
  if (ilat !== null && ilng !== null) return { geo_lat: ilat, geo_lng: ilng, geo_accuracy_m: '', geo_source: 'ip', geo_city: dec(h['x-vercel-ip-city']), geo_region: s(h['x-vercel-ip-country-region'], 10), geo_country: s(h['x-vercel-ip-country'], 4) };
  return { geo_lat: '', geo_lng: '', geo_accuracy_m: '', geo_source: 'none', geo_city: '', geo_region: '', geo_country: '' };
}
const UTM = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
export function buildPayload(body, headers = {}) {
  const pageUrl = cleanUrl(body.page_url), site = cleanUrl(body.website || body.site);
  const email = s(body.email, 254).toLowerCase(), phone = s(body.phone, 40).replace(/[^\d+()\-. ]/g, '');
  const utm = {}; for (const k of UTM) { const v = s(body.utm?.[k] ?? body[k], 200); if (v) utm[k] = v; }
  const full = s(body.name, 160); let first = s(body.first_name, 80), last = s(body.last_name, 80);
  if (full && !first && !last) { const parts = full.split(/\s+/); first = parts.shift().slice(0, 80); last = parts.join(' ').slice(0, 80); }
  const source = s(body.utm?.utm_source ?? body.utm_source, 200) || (cleanUrl(body.referrer) ? new URL(cleanUrl(body.referrer)).hostname : 'direct');
  const website = site || pageUrl;
  return { id: randomUUID(), source: 'myaivalet-goal1-capture', method: s(body.method, 20) === 'redirect' ? 'redirect' : 'form',
    page_url: pageUrl, website, website_url: site, website_host: website ? new URL(website).hostname : '',
    summary: `Website: ${site || '(none)'} | Page: ${pageUrl || '(none)'} | Source: ${source}`,
    traffic_source: source, name: full || [first, last].filter(Boolean).join(' '),
    first_name: first, last_name: last,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', phone,
    referrer: cleanUrl(body.referrer), luminary_id: s(body.luminary_id, 64).replace(/[^\w\-.]/g, ''),
    ...utm, ...geoFrom(body, headers), vendasta_account_group: process.env.VENDASTA_ACCOUNT_GROUP_ID || process.env.VENDASTA_ACCOUNT_ID || null, captured_at: new Date().toISOString(),
    user_agent: s(headers['user-agent'], 300) };
}
const DEFAULT_ORIGINS = ['https://myaivalet.getondeets.ai', 'https://myaivalet.smblogin.com', /^https:\/\/myaivalet-squeeze(-[a-z0-9-]+)?\.vercel\.app$/, /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.websiteprosites\.com$/, /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.smblogin\.com$/];
export function originAllowed(o) {
  if (!o || !/^https:\/\/[^/]+$/i.test(o)) return false; o = o.toLowerCase();
  const extra = String(process.env.CAPTURE_ALLOWED_ORIGINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
    .map(x => x.startsWith('https://*.') ? new RegExp('^https:\\/\\/[a-z0-9-]+(\\.[a-z0-9-]+)*\\.' + x.slice(10).replace(/[.]/g, '\\.') + '$') : x);
  return [...DEFAULT_ORIGINS, ...extra].some(a => typeof a === 'string' ? a === o : a.test(o));
}
function cors(req, res) {
  const o = req.headers?.origin; res.setHeader('Vary', 'Origin');
  if (!o) return true; // server-to-server / non-browser
  let sameHost = false; sameHost = o.toLowerCase() === 'https://' + String(req.headers.host || '').toLowerCase();
  if (originAllowed(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Max-Age', '600'); return true; }
  return sameHost;
}
export default async function handler(req, res) {
  const okOrigin = cors(req, res);
  if (req.method === 'OPTIONS') { res.status(okOrigin ? 204 : 403); return res.end(); }
  if (!okOrigin) return res.status(403).json({ ok: false, message: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  if (s(body.company_fax)) return res.status(200).json({ ok: true, message: 'Thanks!' }); // honeypot: pretend success, drop
  const p = buildPayload(body, req.headers || {});
  if (!p.page_url && !p.website) return res.status(400).json({ ok: false, message: "That doesn't look like a website URL. Try yourbusiness.com." });
  if (isDryRun(req, body)) { // PREVIEW-ONLY dry run: no Zapier, no Vendasta. Returns exactly what would have been sent.
    const hk = process.env.ZAPIER_CAPTURE_WEBHOOK_URL || ''; console.log('CAPTURE_DRY_RUN zapier=skipped vendasta=skipped host=' + p.website_host);
    const eight00 = { wouldCall: false, reason: 'dryRun' }; const zapier = { wouldCall: !!hk, method: 'POST', host: hk ? new URL(hk).host : null, url_configured: !!hk, headers: { 'content-type': 'application/json' }, body: p };
    if (!p.website_url) return res.status(200).json({ ok: true, dryRun: true, eight00, zapier, vendasta: { wouldCall: false, reason: 'no website_url' }, crawl: null });
    try { const r = await dryRunCrawl(p.website_url, { maxPages: body?.maxPages, crawlMode: body?.crawlMode });
      if (!r.complete) return res.status(200).json({ ok: true, dryRun: true, eight00, zapier, crawl: { status: r.st.status, job: r.st.prefix, pages_found: r.st.found, pages_captured: r.st.pages.length, continue: { url: '/api/before-after', body: { job: r.st.prefix } } }, vendasta: { pending: 'finish crawl first' } });
      return res.status(200).json({ ok: true, dryRun: true, eight00, zapier, vendasta: vendastaPlan(r.chunks, r.st),
        crawl: { status: 'complete', mode: r.st.crawlMode, ms: r.ms, invocations: r.st.invocations, pages_found: r.manifest.pages_found, pages_captured: r.manifest.pages_captured, pages_in_kb: r.manifest.pages_in_kb, pages_failed: r.manifest.pages_failed, kbChars: r.manifest.kb.chars, kbChunks: r.manifest.kb.chunks.length, page_cap: r.manifest.page_cap,
          manifest: r.st.prefix + 'manifest.json', kb: r.st.prefix + 'kb.txt', screenshot: r.manifest.screenshot.ok ? r.manifest.screenshot.path : 'unavailable: ' + r.manifest.screenshot.reason } });
    } catch (e) { console.error('CAPTURE_DRY_RUN_CRAWL_FAILED', e.message); return res.status(200).json({ ok: true, dryRun: true, eight00, zapier, vendasta: { wouldCall: false, reason: 'crawl_failed' }, crawl: { status: 'fetch_failed', reason: e.message } }); }
  }
  const hook = process.env.ZAPIER_CAPTURE_WEBHOOK_URL;
  if (!hook || !/^https:\/\/hooks\.zapier\.com\//.test(hook) && process.env.CAPTURE_ALLOW_TEST_HOOK !== '1') {
    console.error('CAPTURE_NOT_CONFIGURED'); return res.status(503).json({ ok: false, message: 'Capture is not configured yet.' });
  }
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('zapier ' + r.status);
  } catch (e) { console.error('CAPTURE_FORWARD_FAILED', e?.message); return res.status(502).json({ ok: false, message: 'Something went wrong. Please try again.' }); }
  // Non-blocking (after response, Vercel waitUntil): full-site crawl -> KB chunks -> Vendasta sources "MyAiValet KB: <host> (part n of N)".
  // Large sites continue server-side via /api/capture-continue. Skips Vendasta quietly without creds / write flag.
  if (p.website_url) { const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || ''); const base = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? 'https://' + host : null;
    const job = startCaptureJob(p.website_url, { base, crawlMode: body?.crawlMode }) /* full-site by default (HARD RULE Oct 16 2026) */.catch(e => { console.error('KB_INGEST_FETCH_FAILED', e.message); return { status: 'fetch_failed' }; });
    if (globalThis.__KB_JOBS) globalThis.__KB_JOBS.push(job); waitUntil(job);
    const k8 = pushTo800Logged(p.website_url, businessName({ ...p, business_name: s(body.business_name || body.company, 200) })); if (globalThis.__K8_JOBS) globalThis.__K8_JOBS.push(k8); waitUntil(k8); }
  return res.status(200).json({ ok: true, id: p.id, geo: { source: p.geo_source, city: p.geo_city, region: p.geo_region, country: p.geo_country, lat: p.geo_lat, lng: p.geo_lng }, host: p.website_host, website_url: p.website_url, kb: p.website_url ? 'training' : 'skipped', message: `Got it! We captured ${p.website_host}.` });
}
