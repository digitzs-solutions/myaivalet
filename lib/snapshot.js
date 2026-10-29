// Before/after: freeze the crawled site ("before") into Vercel Blob under before-after/<domain>/<timestamp>/.
// Writes manifest.json, pages/NN.html (raw), pages/NN.txt (extracted), kb.txt (exact text handed to Zen), screenshot.png (best effort).
// Screenshot: thum.io public screenshot service (no key, no headless browser in the function). Failure is recorded, never fatal.
import { put } from '@vercel/blob';
import { crawlSite, combinePages, MAX_TEXT } from './kb-ingest.js';
const SHOT = u => 'https://image.thum.io/get/width/1280/crop/900/noanimate/' + u;
export function kbText(cr) {
  const head = `Business: ${cr.x.businessName}\nWebsite: ${cr.home.finalUrl}\nPages read: ${cr.pages.length}\n${cr.x.description ? 'Summary: ' + cr.x.description + '\n' : ''}`;
  return (head + '\n' + (cr.pages.length > 1 ? combinePages(cr.pages, MAX_TEXT - head.length - 2) : cr.x.text)).slice(0, MAX_TEXT);
}
export async function screenshot(url, fetchImpl = fetch) {
  try { const r = await fetchImpl(SHOT(url), { signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || ''; if (!r.ok || !/^image\//.test(ct)) return { ok: false, reason: 'http_' + r.status + ' ' + ct };
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 2000) return { ok: false, reason: 'too_small(' + buf.length + ')' };
    return { ok: true, buf, contentType: ct.split(';')[0] };
  } catch (e) { return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : e.message }; }
}
export async function snapshotSite(siteUrl, { crawled, opts = {}, putImpl = put, fetchImpl = fetch, mode = 'live' } = {}) {
  const startedAt = new Date().toISOString();
  const cr = crawled || await crawlSite(siteUrl, { ...opts, keepHtml: true, quiet: true });
  const domain = cr.host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
  const ts = startedAt.replace(/[:.]/g, '-'); const prefix = `before-after/${domain}/${ts}/`;
  const o = ct => ({ access: 'private', contentType: ct, addRandomSuffix: false });
  const kb = kbText(cr); const pages = [];
  await Promise.all(cr.pages.map(async (p, i) => { const n = String(i + 1).padStart(2, '0');
    const files = { text: prefix + `pages/${n}.txt` }; if (p.html) files.html = prefix + `pages/${n}.html`;
    await Promise.all([p.html ? putImpl(files.html, p.html, o('text/html; charset=utf-8')) : null, putImpl(files.text, p.text, o('text/plain; charset=utf-8'))]);
    pages[i] = { n: i + 1, url: p.url, title: p.title, chars: p.text.length, htmlBytes: p.html ? Buffer.byteLength(p.html) : 0, ...files }; }));
  await putImpl(prefix + 'kb.txt', kb, o('text/plain; charset=utf-8'));
  const shot = await screenshot(cr.home.finalUrl, fetchImpl); let screenshotInfo = { ok: false, provider: 'thum.io', reason: shot.reason };
  if (shot.ok) { const ext = shot.contentType.includes('png') ? 'png' : 'jpg'; await putImpl(prefix + 'screenshot.' + ext, shot.buf, o(shot.contentType)); screenshotInfo = { ok: true, provider: 'thum.io', path: prefix + 'screenshot.' + ext, bytes: shot.buf.length }; }
  const manifest = { kind: 'myaivalet-before-snapshot', version: 1, mode, requestedUrl: siteUrl, finalUrl: cr.home.finalUrl, domain, businessName: cr.x.businessName, description: cr.x.description,
    crawlStartedAt: startedAt, snapshotCompletedAt: new Date().toISOString(), crawlMs: cr.stats.ms, stats: cr.stats, pages, excluded: cr.excluded, kb: { path: prefix + 'kb.txt', chars: kb.length }, screenshot: screenshotInfo };
  await putImpl(prefix + 'manifest.json', JSON.stringify(manifest, null, 2), o('application/json'));
  console.log('BEFORE_SNAPSHOT_OK', prefix, 'pages=' + pages.length, 'shot=' + screenshotInfo.ok);
  return { prefix, manifestPath: prefix + 'manifest.json', pages: pages.length, screenshot: screenshotInfo, crawled: cr, kb };
}
// One crawl -> before snapshot -> same content to Zen's KB (ingestSite reuses the crawl). Snapshot failure never blocks ingest.
export async function snapshotThenIngest(siteUrl, ingest) {
  let cr = null, snap = null;
  try { cr = await crawlSite(siteUrl, { keepHtml: true, quiet: true }); snap = await snapshotSite(siteUrl, { crawled: cr }); }
  catch (e) { console.error('BEFORE_SNAPSHOT_FAILED', e.message); }
  const kb = await ingest(siteUrl, cr ? { crawled: cr } : {});
  return { snapshot: snap ? snap.manifestPath : null, kb };
}
