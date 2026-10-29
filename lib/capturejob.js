// HARD RULE (Oct 16 2026): every KB write is a FULL-SITE crawl unless crawlMode:'single' is passed explicitly (see lib/fullcrawl.js).
// Normal /api/capture KB path (prepared for promotion): full-site crawl (lib/fullcrawl.js, 500-page default cap) -> KB chunks (<=100k)
// -> Vendasta as N knowledge sources "MyAiValet KB: <host> (part n of N)". Runs AFTER the form response (waitUntil) in bounded steps;
// large sites hand off to /api/capture-continue (self-POST with a per-job random nonce stored only in private Blob state).
import { randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { startJob, runJob, saveState, loadState, finishStep, readBlob } from './fullcrawl.js';
import { kbConfig } from './kb-ingest.js'; import { token } from './vendasta.js'; import { screenshot } from './snapshot.js'; import { kbSourceName } from './dryrun.js';
export const STEP_BUDGET = 40_000, MAX_STEPS = 30, LIST_PAGES = 10, UPSERT_GAP_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prefixOf = host => `MyAiValet KB: ${host}`;
// Write chunk i..N to Vendasta, resumable via st.kbw. Reuses existing sources for this host (update, not duplicate) in part order.
export async function writeKbSources(st, { deadlineMs = 30_000, c = kbConfig(), fetchImpl = fetch, tokenImpl = token, readImpl = readBlob, gapMs = UPSERT_GAP_MS } = {}) {
  const t0 = Date.now(); const left = () => deadlineMs - (Date.now() - t0);
  if (!c.sa || !c.ag || !c.assistant) { console.log('KB_INGEST_SKIPPED not_configured'); return { done: true, status: 'not_configured' }; }
  if (!c.write) { console.log('KB_INGEST_SKIPPED write_disabled'); return { done: true, status: 'write_disabled' }; }
  if (!/^AG-[A-Z0-9]+$/.test(c.ag) || !/^ASSISTANT-[\w-]+$/.test(c.assistant)) { console.error('KB_INGEST_BAD_IDS'); return { done: true, status: 'bad_config' }; }
  const chunks = st.fin?.chunks || []; const N = chunks.length; const host = st.rootHost || st.domain;
  if (!N) return { done: true, status: 'no_text' };
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + await tokenImpl() };
  const call = async (path, body) => { for (let a = 0; ; a++) { const r = await fetchImpl(c.base + path, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      if (r.ok) return r.json().catch(() => ({})); if (r.status === 429 && a < 2) { await sleep(1500 * (a + 1)); continue; } const e = new Error(path + ' ' + r.status); e.code = r.status; throw e; } };
  const w = st.kbw ||= { i: 0, ids: null, results: [], stale: [] };
  if (!w.ids) { const found = []; let tokenP; // list existing sources for this host (paged), map to part order
    for (let pg = 0; pg < LIST_PAGES; pg++) { const l = await call('/v1/knowledge/list', { accountGroupId: c.ag, pagingOptions: { pageSize: 100, ...(tokenP ? { cursor: tokenP } : {}) } });
      for (const k of l.knowledgeSources || []) if (k.name === prefixOf(host) || (k.name || '').startsWith(prefixOf(host) + ' (part ') || k.name === `Prospect – ${st.businessName} (${host})`) found.push(k);
      tokenP = l.pagingMetadata?.nextCursor; if (!tokenP || !l.pagingMetadata?.hasMore) break; }
    const part = k => { const m = /\(part (\d+) of \d+\)$/.exec(k.name || ''); return m ? +m[1] : (k.name === prefixOf(host) ? 1 : 0.5); };
    found.sort((a, b) => part(a) - part(b)); w.ids = found.slice(0, N).map(k => k.knowledgeSourceId); w.stale = found.slice(N).map(k => ({ id: k.knowledgeSourceId, name: k.name })); }
  const assistants = [c.assistant, ...c.extraAssistants.filter(a => a !== c.assistant)];
  while (w.i < N) { if (left() < 12_000) return { done: false, status: 'writing', written: w.i, of: N };
    const i = w.i, name = kbSourceName(host, i, N).slice(0, 500); const text = await readImpl(chunks[i].path); const existing = w.ids[i] || null;
    try { const base = { accountGroupId: c.ag, name, description: `Auto-added from MyAiValet capture of ${st.finalUrl} on ${new Date().toISOString()} (part ${i + 1} of ${N})`.slice(0, 2000), content: { text: { text } } };
      const j = await call('/v1/knowledge/upsert', { ...base, assistantId: c.assistant, ...(existing ? { knowledgeSourceId: existing } : {}) }); const ks = j.knowledgeSourceId || existing || null; const linked = [c.assistant];
      for (const a of assistants.slice(1)) { try { await call('/v1/knowledge/upsert', { ...base, assistantId: a, knowledgeSourceId: ks }); linked.push(a); } catch (e) { console.error('KB_INGEST_LINK_FAILED', a, e.code || e.message); } }
      w.results.push({ part: i + 1, name, chars: text.length, knowledgeSourceId: ks, updated: !!existing, linked }); }
    catch (e) { console.error('KB_INGEST_FAILED', name, e.code || e.message); w.results.push({ part: i + 1, name, error: e.code || e.message }); if (e.code === 429) return { done: false, status: 'rate_limited', written: i, of: N }; }
    w.i++; if (gapMs && w.i < N) await sleep(gapMs); }
  const ok = w.results.filter(r => !r.error).length;
  if (w.stale.length) console.log('KB_INGEST_STALE_SOURCES', host, w.stale.map(s => s.id + ':' + s.name).join('|'));
  console.log('KB_INGEST_OK multi', 'sources=' + ok + '/' + N, 'updated=' + w.results.filter(r => r.updated).length, 'stale=' + w.stale.length, 'host=' + host);
  return { done: true, status: ok === N ? 'synced' : ok ? 'partial' : 'error', sources: w.results, stale: w.stale };
}
// One bounded step of the whole capture job. Returns state with st.status 'running'|'finishing'|'kb'|'done'.
export async function stepCapture(st, { budgetMs = STEP_BUDGET, putImpl = put, ...o } = {}) {
  const t0 = Date.now(); const left = () => budgetMs - (Date.now() - t0); st.step = (st.step || 0) + 1;
  if (st.status === 'running') await runJob(st, { deadlineMs: Math.max(3000, left() - 15_000), putImpl });
  if (st.status === 'finishing') { const r = await finishStep(st, { putImpl, screenshot: o.screenshotImpl ?? screenshot, readImpl: o.readImpl, deadlineMs: Math.max(3000, left() - 5000) }); if (r.done) st.status = 'kb'; }
  if (st.status === 'complete') st.status = 'kb';
  if (st.status === 'kb') { const r = await writeKbSources(st, { deadlineMs: Math.max(3000, left()), ...o }); if (r.done) { st.status = 'done'; st.kbResult = { status: r.status, sources: r.sources?.length || 0, stale: r.stale?.length || 0 }; } }
  if (st.step >= MAX_STEPS && st.status !== 'done') { console.error('CAPTURE_JOB_GAVE_UP', st.prefix, st.status); st.status = 'done'; st.kbResult = { status: 'gave_up' }; }
  await saveState(st, putImpl); return st;
}
const trigger = async (st, base, fetchImpl) => { // fire-and-forget self call; continue job in a fresh invocation
  try { await fetchImpl(base + '/api/capture-continue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: st.prefix, nonce: st.nonce, step: st.step }), signal: AbortSignal.timeout(5000) }); }
  catch (e) { console.error('CAPTURE_CONTINUE_TRIGGER_FAILED', st.prefix, e.message); } };
export async function startCaptureJob(url, { base, maxPages, crawlMode, fetchImpl = fetch, ...o } = {}) {
  const st = await startJob(url, { mode: 'capture', maxPages, crawlMode, putImpl: o.putImpl, opts: o.opts || {} }); st.nonce = randomBytes(18).toString('base64url'); st.contBase = base || null;
  await stepCapture(st, { ...o, fetchImpl }); console.log('CAPTURE_JOB_STEP', st.prefix, 'step=' + st.step, 'status=' + st.status, 'pages=' + st.pages.length);
  if (st.status !== 'done' && base) await trigger(st, base, fetchImpl); return st;
}
export async function continueCaptureJob({ job, nonce, step }, { fetchImpl = fetch, load = loadState, ...o } = {}) {
  const st = await load(String(job)); if (!st.nonce || st.nonce !== String(nonce)) return { ok: false, code: 403 };
  if (st.status === 'done' || Number(step) !== st.step) return { ok: true, ignored: true, status: st.status }; // duplicate/stale trigger
  await stepCapture(st, { ...o, fetchImpl }); console.log('CAPTURE_JOB_STEP', st.prefix, 'step=' + st.step, 'status=' + st.status, 'pages=' + st.pages.length);
  if (st.status !== 'done' && st.contBase) await trigger(st, st.contBase, fetchImpl); return { ok: true, status: st.status, step: st.step };
}
