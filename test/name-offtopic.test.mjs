import assert from 'node:assert';
const { businessNameFrom, domainToWords, looksWrong } = await import('../api/site-info.js');
const { default: chat, offTopicDomain } = await import('../api/chat.js');
// (a) name override + domain fallback
assert.equal(businessNameFrom('<title>DIGITS</title><meta property="og:site_name" content="DIGITS">', 'getpayments.ai'), 'Get Payments');
assert.equal(businessNameFrom('<title>DIGITS</title>', 'www.getpayments.ai'), 'Get Payments');
assert.equal(domainToWords('getpayments.ai'), 'Get Payments');
assert.equal(domainToWords('fitnessdoctors.com'), 'Fitness Doctors');
assert.equal(domainToWords('my-cool-site.com'), 'My Cool Site');
assert.equal(businessNameFrom('<title>ACME</title>', 'fitnessdoctors.com'), 'Fitness Doctors'); // wrong-looking title -> domain words
assert.equal(businessNameFrom('<meta property="og:site_name" content="Fitness Doctors -" />', 'fitnessdoctors.com'), 'Fitness Doctors');
assert.equal(businessNameFrom('<title>Home | Hummingbird Inn</title>', 'x.com'), 'Hummingbird Inn'); // multi-word real name kept
assert.ok(looksWrong('DIGITS', 'getpayments.ai')); assert.ok(!looksWrong('Fitness Doctors', 'fitnessdoctors.com'));
const res = { status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; } };
const site = '=== Page 1: DIGITS — https://getpayments.ai/ ===\nEric, owner of the Hummingbird Inn, needs $50k for luxury landscaping to become a top wedding venue destination.';
await chat({ method: 'POST', body: { businessName: 'Get Payments', siteText: site, messages: [{ role: 'user', content: 'hi' }] } }, res);
assert.match(res.b.reply, /I'm the AI Valet for Get Payments/);
// (b) off-topic: other domain -> scoped refusal, no quoting, works with and without host (local-retrieval-fallback path)
assert.equal(offTopicDomain('Tell me about angi.com', 'getpayments.ai'), 'angi.com');
assert.equal(offTopicDomain('what is on docs.getpayments.ai', 'getpayments.ai'), '');
for (const host of ['getpayments.ai', undefined]) {
  await chat({ method: 'POST', body: { businessName: 'Get Payments', host, siteText: site, messages: [{ role: 'user', content: 'Tell me about angi.com' }] } }, res);
  assert.equal(res.b.mode, 'off-topic'); assert.match(res.b.reply, /only know about Get Payments/); assert.ok(!/Hummingbird|“/.test(res.b.reply), res.b.reply);
}
await chat({ method: 'POST', body: { businessName: 'Get Payments', siteText: site, messages: [{ role: 'user', content: 'Tell me about the landscaping story' }] } }, res);
assert.equal(res.b.mode, 'local-retrieval-fallback');
console.log('name + off-topic tests ok');
