import assert from 'node:assert';
const fc = await import('../lib/fullcrawl.js'); const { kbSourceName, vendastaPlan } = await import('../lib/dryrun.js');
// page cap: default 500, configurable, clamped to 5000, env fallback
assert.deepEqual(fc.resolveMaxPages(undefined, {}), { cap: 2000, source: 'default', clamped: false });
assert.equal(fc.resolveMaxPages('50', {}).cap, 2000); /* full-site rule: cannot lower below default */ assert.equal(fc.resolveMaxPages('3000', {}).cap, 3000); assert.equal(fc.resolveMaxPages(99999, {}).cap, 5000); assert.equal(fc.resolveMaxPages(99999, {}).clamped, true);
assert.equal(fc.resolveMaxPages(undefined, { CRAWL_MAX_PAGES: '2500' }).source, 'env:CRAWL_MAX_PAGES'); assert.equal(fc.resolveMaxPages('abc', {}).cap, 2000);
// names
assert.equal(kbSourceName('x.test', 1, 3), 'MyAiValet KB: x.test (part 2 of 3)'); assert.equal(kbSourceName('x.test', 0, 1), 'MyAiValet KB: x.test');
// bounded, resumable finalize over a big fake job (3000 pages x 900 chars in 30 parts + one 250k page)
const store = new Map(); let slow = 0;
const putImpl = async (p, b) => { store.set(p, typeof b === 'string' ? b : String(b)); return { pathname: p }; };
const readImpl = async p => { slow++; await new Promise(r => setTimeout(r, 2)); if (!store.has(p)) throw new Error('missing ' + p); return store.get(p); };
const st = { prefix: 'before-after/x.test/T/', businessName: 'X', finalUrl: 'https://x.test/', rootHost: 'x.test', domain: 'x.test', found: 3200, pages: [], parts: [], errors: [], skipped: [], sitemaps: [], queue: [{ url: 'https://x.test/q' }], hardCapHit: true, maxPages: 3001, maxPagesSource: 'request', status: 'finishing', invocations: 7, activeMs: 1 };
let n = 0; for (let k = 0; k < 30; k++) { let t = ''; for (let j = 0; j < 100; j++) { n++; st.pages.push({ n }); t += `\n\n=== Page ${n}: T — https://x.test/${n} ===\n` + 'w'.repeat(900); }
  const pp = st.prefix + `kb-parts/${k}.txt`; store.set(pp, t); st.parts.push(pp); }
n++; st.pages.push({ n }); store.set(st.prefix + 'kb-parts/big.txt', `\n\n=== Page ${n}: huge — https://x.test/h ===\n` + 'z'.repeat(250_000)); st.parts.push(st.prefix + 'kb-parts/big.txt');
let r, steps = 0; do { r = await fc.finishStep(st, { putImpl, readImpl, deadlineMs: 4050 + 30 }); steps++; const s2 = JSON.parse(JSON.stringify(st)); Object.assign(st, s2); } while (!r.done && steps < 500);
assert.ok(r.done); assert.ok(steps > 1, 'took multiple steps: ' + steps);
const m = r.manifest; assert.equal(m.pages_in_kb, 3001); assert.equal(m.pages_captured, 3001);
assert.ok(m.kb.chunks.every(c => c.chars <= 100_000)); assert.ok(m.kb.chunks.length >= 30);
assert.equal(m.page_cap.max_pages, 3001); assert.equal(m.page_cap.hit, true); assert.equal(m.page_cap.not_captured_queued, 1); assert.equal(m.page_cap.source, 'request');
const joined = m.kb.chunks.map(c => store.get(c.path)).join(''); assert.equal(store.get(st.prefix + 'kb.txt'), joined); assert.ok(joined.includes('=== Page 3001: huge'));
assert.equal(joined.length, m.kb.chars); assert.ok(m.kb.full_text_in_kb_txt);
const plan = vendastaPlan(st.fin.chunks, st, { write: false, sa: '', ag: 'AG', assistant: 'A', extraAssistants: [], base: 'https://b' });
assert.equal(plan.chunks, m.kb.chunks.length); assert.ok(plan.requests.every((q, i) => q.body.name === `MyAiValet KB: x.test (part ${i + 1} of ${plan.chunks})`));
assert.equal(st.status, 'complete'); console.log('finalize tests ok steps=' + steps + ' chunks=' + m.kb.chunks.length);
