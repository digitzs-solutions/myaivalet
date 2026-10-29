// POST {url} -> start a FULL-SITE "before" crawl (BFS + sitemap, page cap default 500, body maxPages up to 5000) frozen into Blob under before-after/<domain>/<ts>/.
// Large sites: response {status:'running', job} -> POST {job} again until {status:'complete'} (each call works ~40s, state in Blob).
// Writes manifest.json (pages_found vs pages_captured), pages/NNNN.html + .txt, kb.txt (every captured page), screenshot.
// No Vendasta, CRM, Zapier or lead side effects. Body {test:true} only labels the manifest mode. Body {legacy:true} = old 7-page-style snapshot.
import { snapshotSite, screenshot } from '../lib/snapshot.js'; import { cleanUrl, originAllowed } from './capture.js';
import { startJob, runJob, saveState, loadState, finishStep } from '../lib/fullcrawl.js';
export const config = { maxDuration: 60 };
const DEADLINE = 38_000;
export default async function handler(req, res) {
  const o = req.headers?.origin; res.setHeader('Vary', 'Origin'); res.setHeader('cache-control', 'no-store');
  if (o && !originAllowed(o) && o.toLowerCase() !== 'https://' + String(req.headers.host || '').toLowerCase()) return res.status(403).json({ ok: false, message: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const t0 = Date.now();
  try {
    if (b?.legacy) { const url = cleanUrl(b?.url || b?.website); if (!url) return res.status(400).json({ ok: false, message: "That doesn't look like a website URL." });
      const s = await snapshotSite(url, { mode: b?.test ? 'test' : 'live' }); return res.status(200).json({ ok: true, legacy: true, snapshot: s.manifestPath, pagesRead: s.pages }); }
    let st;
    if (b?.job) st = await loadState(String(b.job));
    else { const url = cleanUrl(b?.url || b?.website); if (!url) return res.status(400).json({ ok: false, message: "That doesn't look like a website URL." });
      st = await startJob(url, { mode: b?.test ? 'test' : 'live', maxPages: b?.maxPages, crawlMode: b?.crawlMode }); }
    if (st.status === 'complete') return res.status(200).json({ ok: true, status: 'complete', job: st.prefix, snapshot: st.prefix + 'manifest.json', pages_captured: st.pages.length });
    const left = () => DEADLINE - (Date.now() - t0);
    if (st.status === 'running') await runJob(st, { deadlineMs: Math.max(5_000, left()) });
    if (st.status === 'finishing') { const r = await finishStep(st, { screenshot, deadlineMs: Math.max(3_000, left()) }); await saveState(st);
      if (r.done) { const m = r.manifest; return res.status(200).json({ ok: true, status: 'complete', job: st.prefix, snapshot: st.prefix + 'manifest.json', pages_found: m.pages_found, pages_captured: m.pages_captured,
        pages_in_kb: m.pages_in_kb, pages_failed: m.pages_failed, invocations: st.invocations, finalizeSteps: m.finalizeSteps, kbChars: m.kb.chars, kbChunks: m.kb.chunks.length, page_cap: m.page_cap,
        screenshot: m.screenshot.ok ? m.screenshot.path : 'unavailable: ' + m.screenshot.reason, businessName: st.businessName, host: st.rootHost, siteText: st.fin.siteText || '' }); }
      return res.status(200).json({ ok: true, status: 'finishing', job: st.prefix, phase: st.fin.phase, kbChunks: st.fin.chunks.length, pages_captured: st.pages.length, invocations: st.invocations, next: { method: 'POST', body: { job: st.prefix } } }); }
    await saveState(st);
    return res.status(200).json({ ok: true, status: 'running', job: st.prefix, pages_found: st.found, pages_captured: st.pages.length, queued: st.queue.length, invocations: st.invocations, next: { method: 'POST', body: { job: st.prefix } } });
  } catch (e) { console.error('BEFORE_AFTER_FAILED', e.message); return res.status(200).json({ ok: false, status: 'fetch_failed', reason: e.message }); }
}
