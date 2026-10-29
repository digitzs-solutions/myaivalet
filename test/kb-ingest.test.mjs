import http from 'node:http'; import assert from 'node:assert'; import { generateKeyPairSync } from 'node:crypto';
const calls = [];
const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  if (q.url === '/site') { r.setHeader('content-type', 'text/html'); return r.end('<html><head><title>Acme Plumbing | Home</title><meta name="description" content="24/7 plumbers in Ocean City"></head><body><script>evil()</script><h1>Acme Plumbing</h1><p>We fix leaks, water heaters and drains. Open 7 days a week, 8am to 8pm. Call 555-0100.</p></body></html>'); }
  if (q.url === '/redir') { r.writeHead(302, { location: 'http://10.0.0.5/secret' }); return r.end(); }
  calls.push({ url: q.url, auth: q.headers.authorization, body: b });
  r.setHeader('content-type', 'application/json');
  if (q.url === '/token') return r.end('{"access_token":"tok123"}');
  if (q.url === '/grpc/v1/knowledge/list') return r.end(JSON.stringify({ knowledgeSources: [{ name: 'Prospect – Other (x.com)', knowledgeSourceId: 'KS-old' }] }));
  if (q.url === '/grpc/v1/knowledge/upsert') return r.end('{"knowledgeSourceId":"KS-new"}');
  r.statusCode = 404; r.end('{}'); }); });
await new Promise(r => srv.listen(0, r)); const P = srv.address().port, L = `http://127.0.0.1:${P}`;
const { ingestSite, safeFetchText, isPrivateIp, extract } = await import('../lib/kb-ingest.js');
// 1) no creds -> graceful skip
delete process.env.VENDASTA_SERVICE_ACCOUNT_JSON; assert.equal((await ingestSite('https://example.com')).status, 'not_configured');
// 2) SSRF guards
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
assert.ok(!isPrivateIp('93.184.216.34'));
await assert.rejects(safeFetchText(L + '/site'), /bad_port/); await assert.rejects(safeFetchText('http://127.0.0.1/'), /private_address/);
await assert.rejects(safeFetchText('http://169.254.169.254/latest/meta-data'), /private_address/);
await assert.rejects(safeFetchText('file:///etc/passwd'), /bad_url/);
const pubLookup = async () => [{ address: '93.184.216.34' }], viaLocal = (u, o) => fetch(L + new URL(u).pathname, o);
await assert.rejects(safeFetchText('http://acme.test/redir', { lookup: async h => h === '10.0.0.5' ? [{ address: '10.0.0.5' }] : pubLookup(), fetchImpl: viaLocal }), /private_address/);
// 3) extraction strips scripts
const x = extract('<title>A | B</title><script>bad()</script><p>Hello &amp; welcome</p>', 'a.com'); assert.equal(x.businessName, 'A'); assert.ok(!x.text.includes('bad')); assert.ok(x.text.includes('Hello & welcome'));
// 4) creds present but write disabled
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.VENDASTA_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sa@test', private_key_id: 'k1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: L + '/token' });
process.env.VENDASTA_ACCOUNT_GROUP_ID = 'AG-P2NXD6D3JK'; process.env.VENDASTA_AI_ASSISTANT_ID = 'ASSISTANT-TEST1'; process.env.VENDASTA_API_BASE = L + '/grpc';
assert.equal((await ingestSite('http://acme.test/site', { lookup: pubLookup, fetchImpl: viaLocal })).status, 'write_disabled'); assert.equal(calls.length, 0);
// 5) full mocked write
process.env.VENDASTA_KB_WRITE_ENABLED = 'true';
const r = await ingestSite('http://acme.test/site', { lookup: pubLookup, fetchImpl: viaLocal });
assert.equal(r.status, 'synced'); assert.equal(r.knowledgeSourceId, 'KS-new');
assert.deepEqual(calls.map(c => c.url), ['/token', '/grpc/v1/knowledge/list', '/grpc/v1/knowledge/upsert']);
assert.ok(calls[0].body.includes('grant_type=urn'));
const up = JSON.parse(calls[2].body); assert.equal(calls[2].auth, 'Bearer tok123');
assert.equal(up.accountGroupId, 'AG-P2NXD6D3JK'); assert.equal(up.assistantId, 'ASSISTANT-TEST1'); assert.equal(up.name, 'Prospect – Acme Plumbing (acme.test)');
assert.ok(up.content.text.text.includes('We fix leaks')); assert.ok(!up.content.text.text.includes('evil')); assert.ok(!('knowledgeSourceId' in up));
console.log('UPSERT_BODY_EXAMPLE', JSON.stringify({ ...up, content: { text: { text: up.content.text.text.slice(0, 120) + '…' } } }, null, 2));
calls.length=0; process.env.VENDASTA_EXTRA_ASSISTANT_IDS='ASSISTANT-voice-receptionist, bad id';
const r2 = await ingestSite('http://acme.test/site', { lookup: pubLookup, fetchImpl: viaLocal });
assert.deepEqual(r2.linked, ['ASSISTANT-TEST1','ASSISTANT-voice-receptionist']); const up2=JSON.parse(calls.at(-1).body); assert.equal(up2.assistantId,'ASSISTANT-voice-receptionist'); assert.equal(up2.knowledgeSourceId,'KS-new');
console.log('ALL KB INGEST TESTS PASSED'); srv.close();
