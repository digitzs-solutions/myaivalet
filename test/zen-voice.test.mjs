import assert from 'node:assert'; import fs from 'node:fs'; import vm from 'node:vm';
const ctx = { console }; ctx.window = ctx; vm.runInNewContext(fs.readFileSync(new URL('../chat/voice.js', import.meta.url), 'utf8'), ctx);
const { createVoiceLoop } = ctx.ZenVoice;
// fake timers / SR / synth
let T = 0, timers = []; const setTimeout_ = (f, ms) => { const t = { f, at: T + ms }; timers.push(t); return t; }, clearTimeout_ = t => { timers = timers.filter(x => x !== t); };
const tick = ms => { T += ms; for (;;) { const due = timers.filter(t => t.at <= T).sort((a, b) => a.at - b.at)[0]; if (!due) break; timers = timers.filter(x => x !== due); due.f(); } };
const recs = []; class SR { constructor() { recs.push(this); this.started = false; } start() { this.started = true; } stop() { this.onend && this.onend(); } abort() { this.aborted = true; } }
const spoken = []; let current = null; const synth = { speak(u) { spoken.push(u.text); current = u; }, cancel() { if (current) { const c = current; current = null; c.onend && c.onend(); } } };
class Utt { constructor(t) { this.text = t; } }
const sent = []; const states = [];
const V = createVoiceLoop({ SR, synth, Utterance: Utt, setTimeout: setTimeout_, clearTimeout: clearTimeout_, now: () => T, silenceMs: 1200, send: async t => { sent.push(t); return 'Reply to ' + t; }, onState: s => states.push(s) });
const R = (t, f) => Object.assign([{ transcript: t }], { isFinal: f }); const ev = (i, ...rs) => ({ resultIndex: i, results: rs });
V.start(); assert.equal(V.state, 'listening'); const r1 = recs.at(-1); assert.equal(r1.continuous, true); assert.equal(r1.interimResults, true);
r1.onresult(ev(0, R('what are your', false))); tick(800); assert.equal(sent.length, 0, 'no send before 1.2s silence');
r1.onresult(ev(0, R('what are your hours', true))); tick(1199); assert.equal(sent.length, 0); tick(2);
await new Promise(r => setImmediate(r)); assert.deepEqual(sent, ['what are your hours']); assert.equal(V.state, 'speaking'); assert.deepEqual(spoken, ['Reply to what are your hours']);
assert.ok(r1.aborted, 'mic recognition paused while speaking');
current.onend(); assert.equal(V.state, 'listening'); const r2 = recs.at(-1); assert.notEqual(r2, r1);
// auto-restart when the browser ends recognition with no speech
r2.onend(); tick(200); assert.equal(V.state, 'listening'); assert.notEqual(recs.at(-1), r2);
// barge-in: loud mic while speaking for >=300ms cancels TTS and listens
recs.at(-1).onresult(ev(0, R('tell me more', true))); tick(1300); await new Promise(r => setImmediate(r)); assert.equal(V.state, 'speaking');
V.level(0.5); tick(100); V.level(0.5); assert.equal(V.state, 'speaking'); tick(250); V.level(0.5); assert.equal(V.state, 'listening');
// one utterance -> exactly one send
assert.equal(sent.length, 2); V.end(); assert.equal(V.state, 'idle'); tick(5000); assert.equal(sent.length, 2);
console.log('zen voice tests ok');
