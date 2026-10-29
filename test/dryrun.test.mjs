import assert from 'node:assert';
const { isDryRun, chunkText, vendastaPlan, KB_CHUNK } = await import('../lib/dryrun.js');
// gating: only preview + explicit flag
assert.equal(isDryRun({ query: { dryRun: '1' } }, {}, { VERCEL_ENV: 'production' }), false);
assert.equal(isDryRun({ query: {} }, { dryRun: true }, { VERCEL_ENV: 'production' }), false);
assert.equal(isDryRun({ query: {} }, {}, { VERCEL_ENV: 'preview' }), false);
assert.equal(isDryRun({ query: { dryRun: '1' } }, {}, { VERCEL_ENV: 'preview' }), true);
assert.equal(isDryRun({ url: '/api/capture?dryRun=1' }, {}, { VERCEL_ENV: 'preview' }), true);
assert.equal(isDryRun({ query: {} }, { dryRun: 1 }, { VERCEL_ENV: 'preview' }), true);
assert.equal(isDryRun({ query: {} }, { dryRun: 1 }, {}), false);
// chunking: <=100k each, lossless
const pages = Array.from({ length: 40 }, (_, i) => `\n\n=== Page ${i + 1}: T — https://x.test/${i} ===\n` + 'w'.repeat(7000)).join('');
const big = 'HEAD\n' + pages + `\n\n=== Page 41: huge — https://x.test/h ===\n` + 'z'.repeat(250_000);
const ch = chunkText(big); assert.ok(ch.length >= 5); assert.ok(ch.every(c => c.length <= KB_CHUNK)); assert.equal(ch.join(''), big);
assert.deepEqual(chunkText('small'), ['small']);
const plan = vendastaPlan(big, { businessName: 'X', rootHost: 'x.test', finalUrl: 'https://x.test/', prefix: 'p/' }, { write: false, sa: '', ag: 'AG-1', assistant: 'ASSISTANT-1', extraAssistants: [], base: 'https://b' });
assert.equal(plan.wouldCall, false); assert.equal(plan.chunks, ch.length); assert.ok(plan.requests[1].body.name === 'MyAiValet KB: x.test (part 2 of ' + ch.length + ')');
// capture handler: dry run must NOT fetch Zapier/Vendasta even when hook is configured
process.env.VERCEL_ENV = 'preview'; process.env.ZAPIER_CAPTURE_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/1/x';
const calls = []; const realFetch = globalThis.fetch; globalThis.fetch = async (u, o) => { calls.push(String(u)); throw new Error('blocked ' + u); };
const { default: handler } = await import('../api/capture.js');
const res = { h: {}, code: 0, body: null, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
await handler({ method: 'POST', headers: {}, query: { dryRun: '1' }, body: { page_url: 'https://myaivalet.getondeets.ai/', name: 'TEST DO-NOT-CONTACT', email: 'test+myaivalet@digitzs.com', phone: '555-0100' } }, res);
assert.equal(res.code, 200); assert.equal(res.body.dryRun, true); assert.equal(res.body.zapier.body.email, 'test+myaivalet@digitzs.com');
assert.ok(!calls.some(u => /zapier|apigateway|vendasta/i.test(u)), 'no outbound: ' + calls.join(','));
// production: dryRun flag ignored -> goes to Zapier path (our stub fetch fails -> 502), proving prod behavior unchanged
process.env.VERCEL_ENV = 'production'; const res2 = { ...res, h: {}, code: 0, body: null };
await handler({ method: 'POST', headers: {}, query: { dryRun: '1' }, body: { page_url: 'https://myaivalet.getondeets.ai/' } }, res2);
assert.equal(res2.code, 502); assert.ok(calls.some(u => u.startsWith('https://hooks.zapier.com/')));
globalThis.fetch = realFetch; console.log('dryrun tests ok');
