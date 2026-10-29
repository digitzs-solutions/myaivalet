// HARD RULE (Oct 16 2026): KB crawl defaults to FULL-SITE; homepage-only only with explicit crawlMode:'single'.
import http from 'node:http'; import assert from 'node:assert';
const big = w => `<p>${(w + ' ').repeat(80)}</p>`;
const pages = { '/': `<title>Home</title>${big('home')}<a href="/a">A</a><a href="/b">B</a>`, '/a': `<title>A</title>${big('alpha')}<a href="/c">C</a>`, '/b': `<title>B</title>${big('bravo')}`, '/c': `<title>C</title>${big('charlie')}`, '/d': `<title>D</title>${big('delta sitemap only')}`,
  '/sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>http://site.test/d</loc></url></urlset>' };
const srv = http.createServer((q, r) => { const p = pages[q.url]; if (p == null) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', q.url.endsWith('.xml') ? 'application/xml' : 'text/html'); r.end(p); });
await new Promise(r => srv.listen(0, r)); const L = `http://127.0.0.1:${srv.address().port}`;
const opts = { lookup: async () => [{ address: '93.184.216.34' }], fetchImpl: (u, o) => fetch(L + new URL(u).pathname, o) };
const fc = await import('../lib/fullcrawl.js'); const putImpl = async () => ({});
assert.equal(fc.CRAWL_MODE_DEFAULT, 'full');
for (const v of [undefined, null, '', 'full', 'homepage', 'FULL', 1]) assert.equal(fc.resolveCrawlMode(v), 'full', String(v));
assert.equal(fc.resolveCrawlMode('single'), 'single');
assert.equal(fc.resolveMaxPages(undefined, {}).cap, fc.DEFAULT_MAX_PAGES); assert.ok(fc.DEFAULT_MAX_PAGES >= 500);
assert.equal(fc.resolveMaxPages(1, {}).cap, fc.DEFAULT_MAX_PAGES, 'maxPages:1 alone must NOT make it homepage-only');
assert.equal(fc.resolveMaxPages(undefined, { CRAWL_MAX_PAGES: '1' }).cap, fc.DEFAULT_MAX_PAGES, 'env cannot force homepage-only');
assert.equal(fc.resolveMaxPages(undefined, {}, 'single').cap, 1);
// default job: crawls every internal page + sitemap-only page
const st = await fc.startJob('http://site.test/', { opts, putImpl });
assert.equal(st.crawlMode, 'full'); while (st.status === 'running') await fc.runJob(st, { deadlineMs: 10000, opts, putImpl });
const got = st.pages.map(p => new URL(p.url).pathname).sort();
for (const p of ['/', '/a', '/b', '/c', '/d']) assert.ok(got.includes(p), 'missing ' + p + ' got ' + got);
// explicit override only
const s1 = await fc.startJob('http://site.test/', { opts, putImpl, crawlMode: 'single' }); assert.equal(s1.crawlMode, 'single'); assert.equal(s1.queue.length, 0);
// legacy single-text Vendasta push is blocked by default
const { pushToVendasta } = await import('../lib/vendasta.js'); process.env.VENDASTA_SERVICE_ACCOUNT_JSON = '{}'; process.env.VENDASTA_PARTNER_ID = process.env.VENDASTA_ACCOUNT_ID = process.env.VENDASTA_CHAT_RECEPTIONIST_ID = 'x';
assert.equal((await pushToVendasta({ businessName: 'X', host: 'x', text: 't' })).status, 'blocked_full_site_rule');
srv.close(); console.log('fullsite-default OK pages=' + got.join(','));
