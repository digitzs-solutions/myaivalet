import assert from 'node:assert';
const { writeKbSources, stepCapture, continueCaptureJob } = await import('../lib/capturejob.js');
const store = new Map(); const putImpl = async (p, b) => { store.set(p, String(b)); return {}; }; const readImpl = async p => { if (!store.has(p)) throw new Error('missing ' + p); return store.get(p); };
const C = { sa: '{}', ag: 'AG-TEST1', assistant: 'ASSISTANT-a', extraAssistants: ['ASSISTANT-b'], write: true, base: 'https://vendasta.mock' };
function mkState(nPages = 3, per = 60_000) { const st = { prefix: 'before-after/x.test/T/', businessName: 'X Co', finalUrl: 'https://x.test/', rootHost: 'x.test', domain: 'x.test', found: nPages, pages: [], parts: [], errors: [], skipped: [], sitemaps: [], queue: [], status: 'finishing', invocations: 1, activeMs: 1, maxPages: 500 };
  let t = ''; for (let i = 1; i <= nPages; i++) { st.pages.push({ n: i }); t += `\n\n=== Page ${i}: P — https://x.test/${i} ===\n` + 'w'.repeat(per); } store.set(st.prefix + 'kb-parts/001.txt', t); st.parts.push(st.prefix + 'kb-parts/001.txt'); return st; }
function mockVendasta(existing = [], { fail429Once = false } = {}) { const calls = []; let n = 0, did429 = false;
  const f = async (u, o) => { const b = JSON.parse(o.body); calls.push({ u: String(u), b });
    if (!String(u).startsWith('https://vendasta.mock/')) throw new Error('unexpected host ' + u);
    if (u.endsWith('/v1/knowledge/list')) return { ok: true, status: 200, json: async () => ({ knowledgeSources: existing }) };
    if (fail429Once && !did429) { did429 = true; return { ok: false, status: 429, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ knowledgeSourceId: b.knowledgeSourceId || 'KS-new' + (++n) }) }; };
  return { f, calls }; }
const O = (m, extra = {}) => ({ c: C, fetchImpl: m.f, tokenImpl: async () => 'tok', readImpl, gapMs: 0, putImpl, screenshotImpl: async () => ({ ok: false, reason: 'test' }), ...extra });
// 1) fresh: 3 pages x 60k -> 2 chunks (<=100k) -> 2 sources, each linked to extra assistant; names "part n of N"
{ const st = mkState(3); const m = mockVendasta(); await stepCapture(st, O(m));
  assert.equal(st.status, 'done'); const ups = m.calls.filter(c => c.u.endsWith('/upsert')); const N = st.fin.chunks.length; assert.ok(N >= 2);
  assert.ok(st.fin.chunks.every(c => c.chars <= 100_000));
  assert.equal(ups.length, N * 2); for (let i = 0; i < N; i++) { assert.equal(ups[2 * i].b.name, `MyAiValet KB: x.test (part ${i + 1} of ${N})`); assert.equal(ups[2 * i].b.assistantId, 'ASSISTANT-a'); assert.equal(ups[2 * i + 1].b.assistantId, 'ASSISTANT-b'); assert.equal(ups[2 * i].b.content.text.text.length, st.fin.chunks[i].chars); }
  assert.equal(st.kbResult.status, 'synced'); assert.equal(st.kbResult.sources, N); assert.equal(ups.map(u => u.b.content.text.text).filter((_, i) => i % 2 === 0).join(''), st.fin.chunks.map(c => store.get(c.path)).join('')); }
// 2) re-capture: reuse existing ids in part order (incl. legacy "Prospect – X Co (x.test)" as part 1), report stale extra parts, other hosts untouched
{ const st = mkState(3); const m = mockVendasta([{ knowledgeSourceId: 'KS-p2', name: 'MyAiValet KB: x.test (part 2 of 4)' }, { knowledgeSourceId: 'KS-old', name: 'Prospect – X Co (x.test)' }, { knowledgeSourceId: 'KS-p3', name: 'MyAiValet KB: x.test (part 3 of 4)' }, { knowledgeSourceId: 'KS-p4', name: 'MyAiValet KB: x.test (part 4 of 4)' }, { knowledgeSourceId: 'KS-other', name: 'MyAiValet KB: y.test' }]);
  await stepCapture(st, O(m)); const prim = m.calls.filter(c => c.u.endsWith('/upsert') && c.b.assistantId === 'ASSISTANT-a');
  assert.equal(prim.length, 3); assert.deepEqual(prim.map(c => c.b.knowledgeSourceId), ['KS-old', 'KS-p2', 'KS-p3']); assert.ok(prim.every((c, i) => c.b.name === `MyAiValet KB: x.test (part ${i + 1} of 3)`)); assert.deepEqual(st.kbw.stale.map(s => s.id), ['KS-p4']); assert.ok(!m.calls.some(c => c.b.knowledgeSourceId === 'KS-other')); assert.equal(st.kbResult.stale, 1); }
// 3) 429 retried once then succeeds
{ const st = mkState(1, 1000); const m = mockVendasta([], { fail429Once: true }); await stepCapture(st, O(m)); assert.equal(st.kbResult.status, 'synced'); assert.equal(m.calls.filter(c => c.u.endsWith('/upsert')).length, 3); }
// 4) write disabled / not configured -> zero Vendasta calls
{ for (const c of [{ ...C, write: false }, { ...C, sa: '' }]) { const st = mkState(1, 1000); const m = mockVendasta(); await stepCapture(st, O(m, { c })); assert.equal(m.calls.length, 0); assert.equal(st.status, 'done'); } }
// 5) bounded + resumable: tiny budget -> not done; continue via nonce (bad nonce 403, stale step ignored)
{ const st = mkState(3); st.nonce = 'n1'; st.contBase = 'https://self.test'; const m = mockVendasta(); const trig = [];
  const fetchImpl = async (u, o) => { if (String(u).startsWith('https://self.test/')) { trig.push(JSON.parse(o.body)); return { ok: true }; } return m.f(u, o); };
  await (await import('../lib/fullcrawl.js')).finishStep(st, { putImpl, readImpl }); st.status = 'kb';
  await writeKbSources(st, { ...O(m), deadlineMs: 1, fetchImpl: m.f }).then(r => assert.equal(r.done, false)); delete st.kbw;
  const load = async () => JSON.parse(JSON.stringify(st)); st.step = 4;
  assert.equal((await continueCaptureJob({ job: st.prefix, nonce: 'bad', step: 4 }, { load, ...O(m), fetchImpl })).code, 403);
  assert.equal((await continueCaptureJob({ job: st.prefix, nonce: 'n1', step: 3 }, { load, ...O(m), fetchImpl })).ignored, true);
  const r = await continueCaptureJob({ job: st.prefix, nonce: 'n1', step: 4 }, { load, ...O(m), fetchImpl }); assert.equal(r.status, 'done'); assert.equal(trig.length, 0); }
console.log('capturejob tests ok');
// 6) handler order: Zapier first, form response returned, THEN crawl job (no Vendasta without creds)
{ process.env.VERCEL_ENV = 'production'; process.env.ZAPIER_CAPTURE_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/1/x'; delete process.env.VENDASTA_SERVICE_ACCOUNT_JSON;
  const seq = []; const real = globalThis.fetch; globalThis.fetch = async (u) => { seq.push(String(u)); if (String(u).startsWith('https://hooks.zapier.com/')) return { ok: true, status: 200 }; throw new Error('offline ' + u); };
  globalThis.__KB_JOBS = []; const { default: handler } = await import('../api/capture.js');
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; seq.push('RESPONSE'); return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { host: 'myaivalet.getondeets.ai' }, query: {}, body: { website: 'example-test.com', page_url: 'https://myaivalet.getondeets.ai/' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.kb, 'training'); assert.ok(seq[0].startsWith('https://hooks.zapier.com/')); assert.equal(seq.indexOf('RESPONSE'), 1);
  assert.equal(globalThis.__KB_JOBS.length, 1); await globalThis.__KB_JOBS[0]; assert.ok(!seq.some(u => /apigateway|vendasta/i.test(u))); globalThis.fetch = real; }
console.log('capturejob handler-order ok');
