// GET /api/site-info?url=… -> { businessName, host, siteText, pages, remembered, businessId, supabaseConfigured }
// Remembers discoveries in Supabase (MyAiValet-GetOnDeets-ai) via remember_discovery / get_business_by_host.
// ?refresh=1 forces a fresh crawl. Read-only crawl path is SSRF-safe; no Vendasta side effects here.
import { crawlSite, combinePages } from '../lib/kb-ingest.js';
import { cleanUrl, originAllowed } from './capture.js';
import { isConfigured, loadByHost, saveDiscovery, isFresh, normalizeHost } from '../lib/remember.js';

const ent = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const tidy = s => String(s || '').replace(/^[\s\-–—|:•]+|[\s\-–—|:•]+$/g, '').slice(0, 120);
export const NAME_OVERRIDES = { 'getpayments.ai': 'Get Payments' };
const WORDS = ['get','payments','payment','pay','my','the','fitness','doctors','doctor','dental','law','group','home','homes','inn','cafe','shop','store','studio','health','care','auto','clinic','pet','pets','real','estate','properties','capital','solutions','services','tech','labs','media','design','bakery','coffee','pizza','house','hotel','travel','fine','green','city','plumbing','roofing','legal','wellness','spa','salon','yoga','gym','fit','smile','smiles','family','kids','school','academy','market','foods','food','farm','garden','gardens','events','fest','lights','valet','ai','deets','on','and','of','for','go','best','pro','pros','north','south','east','west','bay','park','lake','river','hill','street','main','first','one','new','big','little','golden','blue','red','bright','true','next','smart','easy','quick','top','central','local','united','global','american','national'];
export function domainToWords(host) {
  const label = String(host || '').toLowerCase().replace(/^www\./, '').split('.')[0];
  const seg = w => { const n = w.length, best = Array(n + 1).fill(null); best[0] = [];
    for (let i = 1; i <= n; i++) for (let j = 0; j < i; j++) { if (!best[j]) continue; const part = w.slice(j, i);
      if (WORDS.includes(part) || /^\d+$/.test(part)) { const c = best[j].concat(part); if (!best[i] || c.length < best[i].length) best[i] = c; } }
    return best[n] || [w]; };
  return label.split(/[-_]+/).filter(Boolean).flatMap(seg).map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}
export function looksWrong(name, host) {
  const label = String(host || '').toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
  const toks = String(name || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []; if (!toks.length) return true;
  const flat = toks.join(''); const overlap = toks.some(t => label.includes(t) || t.includes(label)) || flat.includes(label) || label.includes(flat);
  return !overlap && (toks.length === 1 || name === String(name).toUpperCase());
}
export function businessNameFrom(html, host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, ''); if (NAME_OVERRIDES[h]) return NAME_OVERRIDES[h];
  const n = tidy(rawName(html, host, true)); return n && !looksWrong(n, host) ? n : domainToWords(host); }
function rawName(html, host, noFallback) {
  const m = re => { const x = String(html || '').match(re); return x ? ent(x[1]) : ''; };
  const og = m(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)/i) || m(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name/i);
  if (og) return og.slice(0, 120);
  for (const s of String(html || '').matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(s[1]); for (const o of [].concat(j['@graph'] || j)) if (o && o.name && /Organization|Business|Hotel|Lodging|Restaurant|Store|BedAndBreakfast|Service/i.test([].concat(o['@type']).join(' '))) return String(o.name).slice(0, 120); } catch {} }
  const t = m(/<title[^>]*>([^<]+)/i); if (t) { const parts = t.split(/\s[|\-–—:•]\s/).map(x => x.trim()).filter(x => x && !/^(home|welcome|homepage)$/i.test(x)); if (parts.length) return parts[0].slice(0, 120); }
  return noFallback ? '' : domainName(host);
}
export const domainName = host => String(host || '').replace(/^www\./, '');

export default async function handler(req, res) {
  const o = req.headers?.origin; res.setHeader('cache-control', 'no-store'); res.setHeader('Vary', 'Origin');
  if (o && !originAllowed(o) && o.toLowerCase() !== 'https://' + String(req.headers.host || '').toLowerCase()) return res.status(403).json({ ok: false });
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const q = req.query?.url ?? new URL(req.url, 'http://x').searchParams.get('url');
  const refresh = String((req.query?.refresh ?? new URL(req.url, 'http://x').searchParams.get('refresh')) || '') === '1';
  const url = cleanUrl(q);
  if (!url) return res.status(400).json({ ok: false, message: "That doesn't look like a website URL." });
  const host = normalizeHost(new URL(url).hostname);
  const configured = isConfigured();

  // Remembered hit (skip crawl when fresh, unless ?refresh=1)
  if (configured && !refresh) {
    try {
      const remembered = await loadByHost(host);
      if (remembered && remembered.site_text && isFresh(remembered.last_discovered_at)) {
        return res.status(200).json({
          ok: true,
          businessName: remembered.display_name || domainName(host),
          host: remembered.host || host,
          pages: remembered.pages_count || 0,
          siteText: String(remembered.site_text || '').slice(0, 30000),
          remembered: true,
          businessId: remembered.id || null,
          supabaseConfigured: true,
          lastDiscoveredAt: remembered.last_discovered_at || null,
        });
      }
    } catch (e) { console.error('SITE_INFO_REMEMBER_READ', e.message); }
  }

  try {
    const cr = await crawlSite(url, { budget: 9000, maxLinks: 25, quiet: true });
    const name = businessNameFrom(cr.home.html, cr.host);
    const siteText = combinePages(cr.pages, 30000);
    const pagesPayload = cr.pages.map(p => ({ url: p.url, title: p.title || '', text: p.text || '' }));
    let businessId = null;
    let saved = false;
    if (configured) {
      const row = await saveDiscovery({
        host: cr.host,
        url: cr.home.finalUrl || url,
        name,
        siteText,
        pages: pagesPayload,
      });
      if (row) { businessId = row.id || null; saved = true; }
    }
    return res.status(200).json({
      ok: true,
      businessName: name,
      host: normalizeHost(cr.host),
      pages: cr.pages.length,
      siteText,
      remembered: false,
      saved,
      businessId,
      supabaseConfigured: configured,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      businessName: domainName(host),
      host,
      pages: 0,
      siteText: '',
      remembered: false,
      businessId: null,
      supabaseConfigured: configured,
      reason: e.message,
    });
  }
}
