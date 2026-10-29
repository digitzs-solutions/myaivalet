// QA gate: node qa/qa.mjs --url <previewShareUrl> --site <testsite> [--expected-prod dpl_…]
// Needs puppeteer-core + Chrome (npm i --no-save puppeteer-core; CHROME=/usr/bin/google-chrome). PREVIEW ONLY: refuses production
// hosts; capture is sent with dryRun=1 (honoured only on VERCEL_ENV=preview). Exits 1 if any automated check fails.
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const share = arg('url'), site = arg('site') || 'fitnessdoctors.com', expectedProd = arg('expected-prod');
if (!share) { console.error('usage: --url <previewShareUrl> --site <site>'); process.exit(2); }
const U = new URL(share); if (/getondeets\.ai$|^myaivalet-squeeze\.vercel\.app$|^myaivalet-squeeze-digitzs-rocks2022\.vercel\.app$/.test(U.hostname)) { console.error('Refusing: production host'); process.exit(2); }
const { default: puppeteer } = await import('puppeteer-core');
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok: ok === true ? 'PASS' : ok === null ? 'MANUAL' : 'FAIL', detail }); };
const host = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
try {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); const errors = []; const caps = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  p.on('request', r => { if (r.url().includes('/api/capture') && r.method() === 'POST') caps.push(r.url()); });
  await p.goto(share, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.goto(U.origin + '/?dryRun=1', { waitUntil: 'networkidle2', timeout: 60000 }); await new Promise(r => setTimeout(r, 5000));
  const s0 = await p.evaluate(() => ({ open: document.getElementById('zen').classList.contains('open'), vis: getComputedStyle(document.getElementById('zen')).visibility,
    vendastaFrames: [...document.querySelectorAll('iframe')].length, url: document.getElementById('url').value, em: document.getElementById('em').value, nm: document.getElementById('nm').value }));
  check('1 no chat auto-opens on load', !s0.open && s0.vis === 'hidden' && s0.vendastaFrames === 0, JSON.stringify(s0));
  check('7 email/name/URL fields empty on fresh context', !s0.url && !s0.em && !s0.nm, JSON.stringify({ url: s0.url, em: s0.em, nm: s0.nm }));
  check('no console errors on load', errors.length === 0, errors.join(' | '));
  const s00 = await p.evaluate(() => ({ step2Hidden: document.getElementById('step2').hidden, emVisible: !!document.getElementById('em').offsetParent, nmVisible: !!document.getElementById('nm').offsetParent, hb: /Hummingbird|Lights Fest|Digits|Digitzs|Zen is reading|30.60 seconds/i.test(document.body.innerText) }));
  check('URL-first: only URL field visible on load; no Hummingbird/Digits/Zen copy', s00.step2Hidden && !s00.emVisible && !s00.nmVisible && !s00.hb, JSON.stringify(s00));
  await p.type('#url', site); await p.click('#b'); await new Promise(r => setTimeout(r, 500));
  const s01 = await p.evaluate(() => ({ step2Visible: !!document.getElementById('em').offsetParent && !!document.getElementById('nm').offsetParent, chatOpen: document.getElementById('zen').classList.contains('open') }));
  check('after URL send: asks for name + email, chat still closed, no capture yet', s01.step2Visible && !s01.chatOpen && caps.length === 0, JSON.stringify(s01));
  await p.type('#nm', 'TEST DO-NOT-CONTACT'); await p.type('#em', 'test+myaivalet@digitzs.com');
  const capResp = p.waitForResponse(r => r.url().includes('/api/capture') && r.request().method() === 'POST', { timeout: 90000 });
  await p.click('#b'); const loading = await p.evaluate(() => ({ t: document.getElementById('b').textContent, d: document.getElementById('b').disabled }));
  check('5a button shows loading state', /Getting your valet ready/.test(loading.t) && loading.d, JSON.stringify(loading));
  let cj = null; try { const r = await capResp; cj = await r.json(); } catch (e) { cj = { error: e.message }; }
  check('5b submit fires /api/capture request (dryRun=1)', caps.length === 1 && caps[0].includes('dryRun=1'), caps.join(','));
  check('5c dry-run payload OK (no real Zapier/Vendasta)', cj && cj.ok === true && cj.dryRun === true && cj.zapier && cj.zapier.body && cj.zapier.body.email === 'test+myaivalet@digitzs.com', JSON.stringify({ ok: cj?.ok, dryRun: cj?.dryRun, err: cj?.error }));
  const names = (cj?.vendasta?.requests || []).map(r => r.body?.name || '');
  const kbOk = cj?.zapier?.body?.website_host?.replace(/^www\./, '') === host && (cj?.crawl?.status !== 'complete' || (names.length > 0 && names.every(n => n.startsWith('MyAiValet KB: ' + host) || n.startsWith('MyAiValet KB: www.' + host))));
  check('8 KB payload is for the tested site only', kbOk, JSON.stringify({ zapHost: cj?.zapier?.body?.website_host, crawl: cj?.crawl?.status, sources: names.length, first: names[0] }));
  await p.waitForFunction(() => document.getElementById('zen').classList.contains('open') || /err/.test(document.getElementById('m').className), { timeout: 60000 }).catch(() => {});
  const s1 = await p.evaluate(() => ({ msg: document.getElementById('m').textContent, cls: document.getElementById('m').className, open: document.getElementById('zen').classList.contains('open'), title: document.getElementById('zen-title').textContent, first: document.querySelector('#zen-log .zb.assistant')?.textContent || '' }));
  check('5d success state shows', /ok/.test(s1.cls) && s1.open, JSON.stringify({ msg: s1.msg, cls: s1.cls }));
  check('3 greeting contains "AI Valet for"', /AI Valet for/.test(s1.first) && /AI Valet for/.test(s1.title), s1.first.slice(0, 120));
  const before = await p.$$eval('#zen-log .zb.assistant', x => x.length);
  await p.type('#zen-in', 'hi there'); await p.keyboard.press('Enter'); await p.click('#zen-form button').catch(() => {}); // double-trigger on purpose
  await new Promise(r => setTimeout(r, 4000));
  const after = await p.$$eval('#zen-log .zb', x => x.map(e => e.className + '|' + e.textContent.slice(0, 60)));
  const users = after.filter(x => x.startsWith('zb user')).length, asst = after.filter(x => x.startsWith('zb assistant')).length - before;
  check('9 one message -> exactly one reply', users === 1 && asst === 1, JSON.stringify(after.slice(-3)));
  const reply = after.at(-1) || ''; check('4/8 reply is scoped (no other prospects)', !/Meredith|Hummingbird|Tartine|Savage Race|Acupuncture|verified information/i.test(reply), reply);
  if (host === 'getpayments.ai') check('3b getpayments greeting exact "I\'m the AI Valet for Get Payments"', s1.first.includes("I'm the AI Valet for Get Payments"), s1.first.slice(0, 80));
  await p.type('#zen-in', 'Tell me about angi.com'); await p.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 4000));
  const ot = await p.$$eval('#zen-log .zb.assistant', x => x.at(-1).textContent);
  check('3c off-topic (angi.com) -> scoped refusal, no quoting', /only know about/.test(ot) && !/“|angi\.com\b.*says/i.test(ot.replace(/can't tell you about angi\.com/, '')), ot.slice(0, 160));
  check('no console errors during flow', errors.length === 0, errors.join(' | '));
} catch (e) { check('qa run', false, e.message); } finally { await b.close(); }
// production deploy guard
if (process.env.VERCEL_TOKEN && expectedProd) { try {
  const r = await fetch('https://api.vercel.com/v6/deployments?projectId=prj_aT74vb26ToJIizHVTdbZCDIv7Rol&teamId=team_LQ5Dunjrf4CMxDN1op5W3cur&target=production&limit=3', { headers: { authorization: 'Bearer ' + process.env.VERCEL_TOKEN } });
  const j = await r.json(); const top = j.deployments?.[0]?.uid; check('no unexpected new production deploy', top === expectedProd, 'latest prod=' + top + ' expected=' + expectedProd); } catch (e) { check('no unexpected new production deploy', false, e.message); } }
else check('no unexpected new production deploy', null, 'set VERCEL_TOKEN + --expected-prod, or check via Vercel list_deployments (target=production)');
check('2/10 voice duplex (hands-free, barge-in) — human mic test', null, 'UNTESTED in headless');
check('10 live waveform listening/speaking — human visual test', null, 'UNTESTED in headless');
for (const r of results) console.log(r.ok.padEnd(6), r.name, r.detail ? '— ' + r.detail.slice(0, 220) : '');
const fails = results.filter(r => r.ok === 'FAIL').length; console.log(fails ? `QA GATE: FAIL (${fails})` : 'QA GATE: PASS (automated) — MANUAL items still required before go-live'); process.exit(fails ? 1 : 0);
