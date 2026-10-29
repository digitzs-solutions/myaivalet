// Manual/internal trigger: POST {url}. Requires header "authorization: Bearer $KB_INGEST_TOKEN" (env). Disabled (404) if KB_INGEST_TOKEN is unset.
// HARD RULE (Oct 16 2026): uses the full-site capture job (every page + sitemap), never the homepage-only path. crawlMode:'single' only if explicit.
import { startCaptureJob } from '../lib/capturejob.js'; import { cleanUrl } from './capture.js'; import { timingSafeEqual } from 'node:crypto';
export default async function handler(req, res) {
  const t = process.env.KB_INGEST_TOKEN; if (!t) return res.status(404).json({ ok: false });
  const got = Buffer.from(String(req.headers?.authorization || '')), want = Buffer.from('Bearer ' + t);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).json({ ok: false });
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const url = cleanUrl(b?.url); if (!url) return res.status(400).json({ ok: false, message: 'bad url' });
  try { return res.status(200).json({ ok: true, ...(await (async () => { const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || ''); const st = await startCaptureJob(url, { base: /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? 'https://' + host : null, crawlMode: b?.crawlMode, maxPages: b?.maxPages }); return { status: st.status, job: st.prefix, crawlMode: st.crawlMode, pages_captured: st.pages.length }; })()) }); } catch (e) { return res.status(200).json({ ok: false, status: 'fetch_failed', reason: e.message }); }
}
