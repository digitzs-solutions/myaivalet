// Hands-free voice conversation loop (pure, testable; browser deps injected).
// listen (SpeechRecognition continuous + interim, auto-restart) -> ~1.2s silence -> auto-send -> speak reply (speechSynthesis)
// -> listen again. Recognition is paused while speaking (echo). Barge-in: sustained mic level while speaking cancels TTS.
(function (g) {
  function createVoiceLoop(o) {
    var SR = o.SR, synth = o.synth, send = o.send, onState = o.onState || function () {}, onText = o.onText || function () {}; var onError = o.onError || function () {};
    var silenceMs = o.silenceMs || 1200, bargeLevel = o.bargeLevel || 0.18, bargeMs = o.bargeMs || 300;
    var setT = o.setTimeout || setTimeout, clearT = o.clearTimeout || clearTimeout, now = o.now || function () { return Date.now(); };
    var state = 'idle', rec = null, finals = [], interim = '', timer = null, loudSince = 0, turn = 0, sentTurns = 0;
    function set(s) { state = s; onState(s); }
    function text() { return finals.filter(Boolean).concat(interim ? [interim] : []).join(' ').replace(/\s+/g, ' ').trim(); }
    function listen() {
      if (state === 'idle') return; finals = []; interim = ''; set('listening');
      var r = new SR(); rec = r; r.lang = o.lang || 'en-US'; r.continuous = o.continuous !== false; /* iOS/mobile: false, auto-restart */ r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = function (e) { if (rec !== r) return; interim = '';
        for (var i = e.resultIndex || 0; i < e.results.length; i++) { var x = e.results[i], t = (x[0] && x[0].transcript || '').trim(); if (!t) continue; if (x.isFinal) finals[i] = t; else interim += (interim ? ' ' : '') + t; }
        onText(text()); clearT(timer); if (text()) timer = setT(flush, silenceMs); };
      r.onerror = function (e) { var c = e && e.error; if (c === 'no-speech' || c === 'aborted') return; // harmless: keep listening
        if (c === 'not-allowed' || c === 'service-not-allowed') { end(); onState('denied'); onError(c); return; }
        if (c === 'audio-capture' || c === 'network' || c === 'language-not-supported') { end(); onError(c); } };
      r.onend = function () { if (rec !== r) return; rec = null; if (state === 'listening') { if (text()) flush(); else setT(function () { if (state === 'listening' && !rec) listen(); }, 150); } }; // auto-restart
      try { r.start(); } catch (e) { if (!(e && e.name === 'InvalidStateError')) { end(); onError('start-failed'); } }
    }
    function stopRec() { var r = rec; rec = null; clearT(timer); if (r) try { r.abort ? r.abort() : r.stop(); } catch (e) {} }
    function flush() { var t = text(); clearT(timer); if (!t || state !== 'listening') return; var my = ++turn; stopRec(); set('thinking'); onText('');
      Promise.resolve(send(t)).then(function (reply) { if (state === 'idle' || my !== turn) return; sentTurns++; speak(reply); }, function () { if (state !== 'idle') listen(); }); }
    var cur = null;
    function speak(reply) { if (!reply || !synth) return listen(); cur = null; try { synth.cancel(); } catch (e) {} set('speaking'); loudSince = 0;
      var u = new (o.Utterance || g.SpeechSynthesisUtterance)(String(reply).replace(/[“”"]/g, '').slice(0, 1200)); u.lang = o.lang || 'en-US'; cur = u;
      u.onend = u.onerror = function () { if (cur === u && state === 'speaking') { cur = null; if (!o.afterSpeakMs) listen(); else setT(function () { if (state === 'speaking' && !cur) listen(); }, o.afterSpeakMs); } }; /* delay avoids mic catching the tail of our own speech */ if (o.onUtterance) o.onUtterance(u); synth.speak(u); }
    function level(v) { if (state !== 'speaking') { loudSince = 0; return; } if (v >= bargeLevel) { if (!loudSince) loudSince = now(); else if (now() - loudSince >= bargeMs) { loudSince = 0; cur = null; synth.cancel(); listen(); } } else loudSince = 0; }
    function start() { if (state !== 'idle') return; state = 'starting'; listen(); }
    function end() { turn++; cur = null; stopRec(); if (synth) try { synth.cancel(); } catch (e) {} set('idle'); }
    return { start: start, end: end, level: level, get state() { return state; }, get turns() { return sentTurns; }, _flush: flush };
  }
  g.ZenVoice = { createVoiceLoop: createVoiceLoop };
  if (typeof module !== 'undefined') module.exports = g.ZenVoice;
})(typeof window !== 'undefined' ? window : globalThis);
