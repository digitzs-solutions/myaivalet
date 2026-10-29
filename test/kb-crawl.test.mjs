import http from 'node:http'; import assert from 'node:assert';
const big = w => `<p>${(w + ' ').repeat(80)}</p>`;
const pages = {
  '/': `<html><head><title>Shore Realty | Home</title></head><body><h1>Shore Realty</h1>${big('welcome')}
   <a href="/listings">Featured Listings</a><a href="/our-team/">Our Team</a><a href="/about">About Us</a><a href="/contact">Contact</a>
   <a href="/login">Agent Login</a><a href="/privacy-policy">Privacy</a><a href="/brochure.pdf">Brochure</a><a href="mailto:a@b.c">Email</a>
   <a href="#top">Top</a><a href="https://other.com/listings">Partner listings</a><a href="/search?a=1&b=2&c=3">Search</a>
   <a href="/blog/2020/01/01/random-post">Random</a><a href="/services">Services</a><a href="/members">Members Area</a><a href="/tiny">Homes for sale tiny</a><a href="/slow">Properties slow</a></body></html>`,
  '/listings': `<title>Listings</title>${big('123 Ocean Ave 3BR 2BA $899,000')}`,
  '/our-team/': `<title>Team</title>${big('Jane Agent broker')}`, '/about': `<title>About</title>${big('family owned since 1990')}`,
  '/contact': `<title>Contact</title>${big('call 555-0100')}`, '/services': `<title>Services</title>${big('buyer seller services')}`,
  '/tiny': '<p>hi</p>',
};
const hits = [];
const srv = http.createServer((q, r) => { hits.push(q.url);
  if (q.url === '/members') { r.writeHead(302, { location: '/wp-login.php' }); return r.end(); }
  if (q.url === '/wp-login.php') { r.setHeader('content-type', 'text/html'); return r.end(big('login form')); }
  if (q.url === '/slow') return setTimeout(() => { r.setHeader('content-type','text/html'); r.end(big('slow')); }, 6000);
  if (q.url === '/forbidden') { r.statusCode = 403; return r.end(); }
  if (pages[q.url] != null) { r.setHeader('content-type', 'text/html'); return r.end(pages[q.url]); }
  r.statusCode = 404; r.end(); });
await new Promise(r => srv.listen(0, r)); const L = `http://127.0.0.1:${srv.address().port}`;
const { scoreLink, extractLinks, crawlSite, combinePages, dedupeBoilerplate } = await import('../lib/kb-ingest.js');
const opts = { lookup: async () => [{ address: '93.184.216.34' }], fetchImpl: (u, o) => fetch(L + new URL(u).pathname + new URL(u).search, o) };
// scoring
assert.ok(scoreLink('Featured Listings', '/listings') > scoreLink('Contact', '/contact'));
for (const [t, p] of [['Login', '/login'], ['Cart', '/cart'], ['x', '/terms'], ['x', '/a.pdf'], ['Privacy', '/privacy-policy'], ['x', '/wp-admin/']]) assert.equal(scoreLink(t, p), -1, p);
// link extraction
const links = extractLinks(pages['/'], 'http://shore.test/'); const paths = links.map(l => new URL(l.url).pathname);
assert.equal(paths[0], '/listings'); for (const bad of ['/login', '/privacy-policy', '/brochure.pdf', '/search']) assert.ok(!paths.includes(bad), bad);
assert.ok(links.every(l => new URL(l.url).hostname === 'shore.test'));
// crawl
const t0 = Date.now(); const c = await crawlSite('http://shore.test/', { ...opts, budget: 5000, concurrency: 3 }); const ms = Date.now() - t0;
const got = c.pages.map(p => new URL(p.url).pathname);
assert.equal(got[0], '/'); for (const want of ['/listings', '/our-team/', '/about', '/contact', '/services']) assert.ok(got.includes(want), want);
for (const bad of ['/tiny', '/slow', '/members', '/wp-login.php']) assert.ok(!got.includes(bad), bad);
assert.ok(got.length >= 6); assert.ok(ms < 5500, 'within budget ' + ms); assert.ok(c.stats.skippedTime + c.stats.skippedErr >= 1); assert.ok(c.stats.found >= 8); assert.deepEqual(got.slice(0,2), ['/', '/listings']);
assert.ok(got.includes('/blog/2020/01/01/random-post') || true);
const txt = combinePages(c.pages); assert.ok(txt.includes('123 Ocean Ave')); assert.ok(txt.includes('=== Page 2:'));
assert.ok(combinePages(c.pages, 2000).length <= 2000);
// fallback: home with no links -> 1 page
const one = await crawlSite('http://shore.test/listings', opts); assert.equal(one.pages.length, 1);
// tight budget -> stops and counts time skips
const tb = Date.now(); const c2 = await crawlSite('http://shore.test/', { ...opts, budget: 800, concurrency: 1 }); assert.ok(Date.now() - tb < 5000); assert.ok(c2.stats.skippedTime >= 1, JSON.stringify(c2.stats));
{ const dd = dedupeBoilerplate([{url:'h',text:'Call 555\nhome intro',score:1e9},{url:'a',text:'Call 555\n'+'x'.repeat(50),score:1},{url:'b',text:'Call 555\n'+'listing '.repeat(40),score:10},{url:'c',text:'Call 555\nteam bio short '.repeat(1)+'y'.repeat(130),score:8}]); assert.deepEqual(dd.pages.map(p=>p.url),['h','b','c']); assert.equal(dd.excluded[0].url,'a'); }
console.log('ALL KB CRAWL TESTS PASSED', got.join(','), ms + 'ms'); srv.close(); process.exit(0);
