import http from 'node:http'; import assert from 'node:assert';
const got = []; const srv = http.createServer((q, r) => { let b=''; q.on('data', c => b += c); q.on('end', () => { got.push(JSON.parse(b)); r.end('{"status":"success"}'); }); });
await new Promise(r => srv.listen(0, r));
process.env.ZAPIER_CAPTURE_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/hooks/catch/test`; process.env.CAPTURE_ALLOW_TEST_HOOK = '1';
const { default: h } = await import('../api/capture.js');
const call = (body, hd={}) => new Promise(done => { const res = { s:200, H:{}, setHeader(k,v){this.H[k]=v;}, end(){done({status:this.s, H:this.H});}, status(c){this.s=c;return this;}, json(j){done({status:this.s, j, H:this.H});} }; h({ method: hd.__m || 'POST', body, headers:{'user-agent':'test', ...hd} }, res); });
let r = await call({ page_url:'https://getondeets.ai/myaivalet/?l=lum42&utm_source=fb', website:'acmeplumbing.com', first_name:'Ann', email:'ANN@Acme.com', phone:'555-1212<script>', referrer:'https://facebook.com/', luminary_id:'lum42', utm:{utm_source:'fb'}, method:'form' });
assert.equal(r.status, 200); assert.equal(got.length, 1);
assert.equal(got[0].website, 'https://acmeplumbing.com/'); assert.equal(got[0].email, 'ann@acme.com'); assert.equal(got[0].luminary_id, 'lum42'); assert.equal(got[0].utm_source, 'fb'); assert.ok(!got[0].phone.includes('<'));
r = await call({ website:'redirected.com', method:'redirect' }); assert.equal(r.status, 200); assert.equal(got[1].method, 'redirect');
const IP={'x-vercel-ip-latitude':'40.7128','x-vercel-ip-longitude':'-74.0060','x-vercel-ip-city':'New%20York','x-vercel-ip-country-region':'NY','x-vercel-ip-country':'US'};
r = await call({ website:'geo.com', lat:'26.12', lng:'-80.14', accuracy:'35.6' }, IP); assert.equal(got.at(-1).geo_source,'browser'); assert.equal(got.at(-1).geo_lat,26.12); assert.equal(got.at(-1).geo_accuracy_m,36);
r = await call({ website:'geo.com', lat:'999', lng:'0' }, IP); assert.equal(got.at(-1).geo_source,'ip'); assert.equal(got.at(-1).geo_city,'New York'); assert.equal(got.at(-1).geo_lng,-74.006);
r = await call({ website:'geo.com' }, {'x-vercel-ip-latitude':'abc'}); assert.equal(got.at(-1).geo_source,'none');
const N=got.length;
r = await call({ website:'spam.com', company_fax:'x' }); assert.equal(r.status, 200); assert.equal(got.length, N, 'honeypot must not forward');
r = await call({ website:'javascript:alert(1)' }); assert.equal(r.status, 400);
r = await call({ website:'not a url' }); assert.equal(r.status, 400); assert.equal(got.length, N);
delete process.env.ZAPIER_CAPTURE_WEBHOOK_URL; r = await call({ website:'a.com' }); assert.equal(r.status, 503);
// CORS
const pre = async o => call({}, { __m:'OPTIONS', origin:o, host:'myaivalet.getondeets.ai' });
for (const o of ['https://myaivalet.getondeets.ai','https://myaivalet.smblogin.com','https://acme.websiteprosites.com','https://myaivalet-squeeze-abc123-digitzs-rocks2022.vercel.app']) { const x = await pre(o); assert.equal(x.status, 204, o); assert.equal(x.H['Access-Control-Allow-Origin'], o); }
for (const o of ['https://evil.com','https://websiteprosites.com.evil.com','http://myaivalet.getondeets.ai','https://other-project.vercel.app']) { const x = await pre(o); assert.equal(x.status, 403, o); assert.ok(!x.H['Access-Control-Allow-Origin']); }
process.env.CAPTURE_ALLOWED_ORIGINS = 'https://vibe.example.com, https://*.vibeapps.test'; assert.equal((await pre('https://vibe.example.com')).status, 204); assert.equal((await pre('https://a.b.vibeapps.test')).status, 204); assert.equal((await pre('https://vibeapps.test.evil.com')).status, 403);
process.env.ZAPIER_CAPTURE_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/hooks/catch/test`;
let c = await call({ website:'x.com' }, { origin:'https://evil.com', host:'myaivalet.getondeets.ai' }); assert.equal(c.status, 403);
c = await call({ website:'x.com' }, { origin:'https://acme.websiteprosites.com', host:'myaivalet.getondeets.ai' }); assert.equal(c.status, 200); assert.equal(c.H['Access-Control-Allow-Origin'], 'https://acme.websiteprosites.com');
c = await call({ website:'x.com' }, { origin:'https://myaivalet.getondeets.ai', host:'myaivalet.getondeets.ai' }); assert.equal(c.status, 200);
r = await call({ website:'hummingbirdinneaston.com', email:'t@x.com', name:'TEST Live Demo', page_url:'https://myaivalet.getondeets.ai/', utm:{utm_source:'ig'} });
const L=got.at(-1); assert.equal(L.website_url,'https://hummingbirdinneaston.com/'); assert.equal(L.first_name,'TEST'); assert.equal(L.last_name,'Live Demo');
assert.equal(L.summary,'Website: https://hummingbirdinneaston.com/ | Page: https://myaivalet.getondeets.ai/ | Source: ig'); assert.equal(r.j.host,'hummingbirdinneaston.com');
console.log('CORS TESTS PASSED');
console.log('PAYLOAD_EXAMPLE', JSON.stringify(got[0], null, 2)); console.log('ALL CAPTURE TESTS PASSED'); srv.close();
