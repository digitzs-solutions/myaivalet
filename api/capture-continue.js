// Server-side continuation of a large capture job (crawl -> KB chunks -> Vendasta sources). Called only by lib/capturejob.js itself.
// Auth: per-job random nonce kept in private Blob state; wrong nonce -> 403; duplicate/stale step -> ignored. Work happens after the 202.
import { continueCaptureJob } from '../lib/capturejob.js';
export const config = { maxDuration: 60 };
let waitUntil = p => { p.catch(() => {}); }; try { ({ waitUntil } = await import('@vercel/functions')); } catch {}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } } b = b || {};
  if (!/^before-after\/[a-z0-9.-]+\/[0-9TZ-]+\/$/.test(String(b.job || '')) || !b.nonce) return res.status(400).json({ ok: false });
  const job = continueCaptureJob(b).then(r => { if (r.code === 403) console.error('CAPTURE_CONTINUE_BAD_NONCE', b.job); return r; }).catch(e => { console.error('CAPTURE_CONTINUE_FAILED', b.job, e.message); });
  waitUntil(job); return res.status(202).json({ ok: true, accepted: true });
}
