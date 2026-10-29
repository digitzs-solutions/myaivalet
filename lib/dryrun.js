// Dry-run support (preview only). Active ONLY when VERCEL_ENV === 'preview' AND the request asks (?dryRun=1 or body.dryRun true/"1").
// In dry run, capture never calls Zapier or Vendasta; it returns exactly what WOULD have been sent.
import { put } from '@vercel/blob';
import { startJob, runJob, saveState, finishStep } from './fullcrawl.js';
import { screenshot } from './snapshot.js';
import { kbConfig } from './kb-ingest.js';
export const KB_CHUNK = 100_000;
const truthy = v => v === true || v === 1 || v === '1' || v === 'true';
export function isDryRun(req, body, env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return false; // production/dev: never
  let q = req?.query?.dryRun; if (q == null) { try { q = new URL(req?.url || '', 'http://x').searchParams.get('dryRun'); } catch {} }
  return truthy(q) || truthy(body?.dryRun);
}
// Split on page boundaries where possible; every piece <= max chars; nothing dropped.
export function chunkText(text, max = KB_CHUNK) {
  const out = []; let cur = '';
  const parts = String(text).split(/(?=\n\n=== Page \d+: )/);
  for (let p of parts) {
    while (p.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, max)); p = p.slice(max); }
    if (cur.length + p.length > max) { out.push(cur); cur = p; } else cur += p;
  }
  if (cur) out.push(cur); return out;
}
export function kbSourceName(host, i, n) { return n > 1 ? `MyAiValet KB: ${host} (part ${i + 1} of ${n})` : `MyAiValet KB: ${host}`; }
// chunks: [{path, chars, preview}] from finishStep (st.fin.chunks); or a plain string (chunked here).
export function vendastaPlan(chunks, st, c = kbConfig()) {
  if (typeof chunks === 'string') chunks = chunkText(chunks).map((t, i) => ({ path: `${st.prefix}kb/${String(i + 1).padStart(3, '0')}.txt`, chars: t.length, preview: t.slice(0, 2000) }));
  const n = chunks.length; const host = st.rootHost || st.domain;
  const assistants = [c.assistant, ...c.extraAssistants.filter(a => a !== c.assistant)].filter(Boolean);
  return { wouldCall: c.write && !!(c.sa && c.ag && c.assistant), gate: { VENDASTA_KB_WRITE_ENABLED: c.write, service_account_set: !!c.sa, account_group: c.ag || null, assistant: c.assistant || null },
    endpoint: c.base + '/v1/knowledge/upsert', chunks: n, chunkChars: chunks.map(x => x.chars), totalChars: chunks.reduce((a, x) => a + x.chars, 0),
    requests: chunks.map((x, i) => ({ path: '/v1/knowledge/upsert', name: kbSourceName(host, i, n), body: { accountGroupId: c.ag || null, assistantId: c.assistant || null, name: kbSourceName(host, i, n).slice(0, 500),
      description: `Auto-added from MyAiValet capture of ${st.finalUrl}`, content: { text: { text: x.chars > 2000 ? x.preview + ` …[+${x.chars - 2000} chars; full text in Blob ${x.path}]` : x.preview } } } })),
    extraAssistantLinks: assistants.slice(1) };
}
// Full-site crawl + bounded finalize inside one request; if unfinished, returns job for continuation via /api/before-after {job}.
export async function dryRunCrawl(url, { deadlineMs = 45_000, putImpl = put, maxPages, crawlMode } = {}) {
  const t0 = Date.now(); const st = await startJob(url, { mode: 'dry-run', putImpl, maxPages, crawlMode }); const left = () => deadlineMs - (Date.now() - t0);
  while (st.status === 'running' && left() > 8000) await runJob(st, { deadlineMs: left() - 8000, putImpl });
  if (st.status === 'finishing') { const r = await finishStep(st, { putImpl, screenshot, deadlineMs: Math.max(3000, left()) });
    await saveState(st, putImpl); if (r.done) return { st, manifest: r.manifest, chunks: st.fin.chunks, complete: true, ms: Date.now() - t0 }; }
  await saveState(st, putImpl); return { st, complete: false, ms: Date.now() - t0 };
}
