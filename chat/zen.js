// MyAiValet squeeze: URL + email -> /api/capture (Zapier, then crawl+KB server-side) and /api/site-info (this business's
// name + site text) -> opens OUR scoped "AI Valet for <Business>" chat (/api/chat with that site's text only).
// The shared Vendasta widget is no longer loaded here (it auto-opened, mixed other prospects' KB, greeted as "chat receptionist").
(function () {
  var $ = function (i) { return document.getElementById(i); };
  var f = $('f'), m = $('m'), b = $('b'), panel = $('zen'), launch = $('zen-launch'), log = $('zen-log'), inp = $('zen-in'), note = $('zen-note');
  var Q = new URLSearchParams(location.search), DRY = Q.get('dryRun') === '1';
  var S = { businessName: '', host: '', siteText: '', msgs: [], busy: false, last: '', lastAt: 0, sends: 0 };
  window.__zen = S; // QA hook (read-only state)
  // (7) fields always start empty; explicit ?email= / ?name= prefill only.
  function clearFields() { ['url', 'em', 'nm'].forEach(function (id) { $(id).value = ''; }); if (Q.get('email')) $('em').value = Q.get('email'); if (Q.get('name')) $('nm').value = Q.get('name'); }
  clearFields(); addEventListener('pageshow', function (e) { if (e.persisted) clearFields(); });
  function bubble(role, text) { var d = document.createElement('div'); d.className = 'zb ' + role; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function open() { panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); launch.hidden = true; inp.focus(); }
  function close() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); launch.hidden = !S.host; if (V) V.end(); }
  $('zen-close').onclick = close; launch.onclick = open; addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
  // (9) single send pipeline: one listener, in-flight lock, duplicate guard -> exactly one reply per message.
  function ask(text) { text = String(text || '').trim(); if (!text || S.busy) return Promise.resolve(''); var t = Date.now();
    if (text === S.last && t - S.lastAt < 1500) return Promise.resolve(''); S.last = text; S.lastAt = t; S.busy = true; S.sends++;
    bubble('user', text); S.msgs.push({ role: 'user', content: text }); var w = bubble('assistant pending', '…');
    return fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: S.businessName, host: S.host, siteText: S.siteText, messages: S.msgs }) })
      .then(function (r) { return r.json(); }).then(function (j) { var rep = j.reply || 'Sorry — I could not answer that.'; w.className = 'zb assistant'; w.textContent = rep; S.msgs.push({ role: 'assistant', content: rep }); return rep; })
      .catch(function () { w.className = 'zb assistant err'; w.textContent = 'Connection problem — please try again.'; return ''; }).then(function (x) { S.busy = false; return x; }); }
  $('zen-form').addEventListener('submit', function (e) { e.preventDefault(); var t = inp.value; inp.value = ''; ask(t); });
  // (2/10) hands-free voice conversation
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, vb = $('zen-voice'), wave = window.ZenWave && ZenWave.createWave($('zen-wave')), V = null;
  if (!SR || !window.speechSynthesis) { vb.disabled = true; note.textContent = 'Voice conversation needs Chrome or Edge (Safari support is limited).'; }
  var MICERR = { NotAllowedError: 'Mic blocked — allow microphone in your browser (address bar or Settings), then tap again.', SecurityError: 'Mic blocked — allow microphone in your browser, then tap again.', 'not-allowed': 'Mic blocked — allow microphone in your browser, then tap again.', 'service-not-allowed': 'Voice-to-text is turned off in this browser. Try Chrome or Edge, or type your question.', NotFoundError: 'No microphone found — plug one in or check your device settings.', 'audio-capture': 'Your microphone is busy or unavailable — close other apps using it and try again.', NotReadableError: 'Your microphone is busy or unavailable — close other apps using it and try again.', network: 'Voice-to-text could not reach its service. Check your connection, or use Chrome or Edge.', 'language-not-supported': 'Voice-to-text does not support this language here. Please type instead.', insecure: 'Microphone needs a secure (https) page.', unsupported: 'This browser does not support the microphone. Try Chrome or Edge.', 'start-failed': 'Voice-to-text could not start. Please try again or type your question.', error: 'Could not start the microphone. Please try again or type your question.' };
  var LABEL = { listening: 'Listening… just talk', thinking: 'Thinking…', speaking: 'Speaking… (talk to interrupt)', idle: '', denied: 'Microphone blocked — allow it in the address bar.' };
  var UA = navigator.userAgent || '', IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1), MOBILE = IOS || /Android|Mobi/i.test(UA);
  if (MOBILE) LABEL.speaking = 'Speaking… (no sound? turn off silent mode and turn the volume up)';
  // Pick the most natural en-US voice the device offers (iOS: Samantha/Enhanced/Premium; Chrome: Google US English; Edge: Natural).
  function bestVoice() { var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || []; var en = vs.filter(function (v) { return /^en[-_]US/i.test(v.lang); }); if (!en.length) en = vs.filter(function (v) { return /^en/i.test(v.lang); });
    var pref = [/Natural/i, /Premium/i, /Enhanced/i, /Google US English/i, /Samantha/i, /Ava/i, /Allison/i];
    for (var i = 0; i < pref.length; i++) for (var j = 0; j < en.length; j++) if (pref[i].test(en[j].name)) return en[j]; return en[0] || null; }
  if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () { speechSynthesis.getVoices(); }; }
  // Echo guard: if the mic picked up our own spoken reply, don't post it as the visitor's words.
  function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }
  function echoSafeAsk(t) { var n = norm(t), lastA = ''; for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].role === 'assistant') { lastA = norm(S.msgs[i].content); break; }
    if (n.length > 6 && lastA.indexOf(n) >= 0) return Promise.resolve(''); return ask(t); }
  vb.onclick = function () { if (V && V.state !== 'idle') { V.end(); return; }
    // Unlock text-to-speech inside the tap (iOS only allows audio started by a user gesture).
    try { var unlock = new SpeechSynthesisUtterance(' '); unlock.volume = 0; window.speechSynthesis.speak(unlock); } catch (e) {}
    // Mobile/iOS: don't hold a separate getUserMedia stream (it blocks SpeechRecognition); start recognition right in the tap.
    (MOBILE ? { then: function (cb) { cb(true); } } : wave.mic()).then(function (ok) { if (ok !== true) { note.textContent = MICERR[ok] || MICERR.error; return; }
      V = ZenVoice.createVoiceLoop({ SR: SR, synth: window.speechSynthesis, send: echoSafeAsk, afterSpeakMs: MOBILE ? 600 : 0, silenceMs: 1200, continuous: !MOBILE,
        onError: function (c) { setTimeout(function () { note.textContent = MICERR[c] || MICERR.error; }, 0); },
        onText: function (t) { note.textContent = t ? 'Heard: ' + t : LABEL[V.state] || ''; },
        onUtterance: function (u) { var bv = bestVoice(); if (bv) { u.voice = bv; u.lang = bv.lang; } u.onboundary = function () { wave.pulse(); }; },
        onState: function (s) { wave.set(s === 'denied' ? 'idle' : s); note.textContent = LABEL[s] || ''; panel.dataset.voice = s;
          vb.textContent = s === 'idle' || s === 'denied' ? '🎙 Start voice conversation' : '■ End conversation'; vb.classList.toggle('on', s !== 'idle' && s !== 'denied'); if (s === 'idle' || s === 'denied') wave.stop(); } });
      wave.onLevel(function (l) { V && V.level(l); }); V.start(); }); };
  // (5) main form: validation, loading, success, error states; capture + site context in parallel.
  function state(cls, text) { m.className = 'msg ' + cls; m.textContent = text; }
  function busy(on) { b.disabled = on; b.setAttribute('aria-busy', on ? 'true' : 'false'); b.textContent = on ? 'Getting your valet ready…' : 'Meet my AI valet — free'; }
  // Opening greeting: edit here. {business} is replaced with the visitor's business name.
  var GREETING = "Hi, I'm the AI Valet for {business}. I'd love to, would you like me to share what we do?";
  var revealedAt = 0, savedUrl = ''; ['nm', 'em'].forEach(function (id) { $(id).addEventListener('input', function () { if (/\berr\b/.test(m.className)) state('', ''); }); });
  f.addEventListener('submit', function (e) { e.preventDefault(); if (b.disabled) return; var u = $('url').value.trim() || savedUrl, em = $('em').value.trim(), nm = $('nm') ? $('nm').value.trim() : ''; state('', '');
    if (!u) { state('err', 'Please paste your website URL.'); $('url').focus(); return; }
    // Effortless remember path: one URL → discover → companion. Name/email optional (no signup gate).
    savedUrl = u;
    if ($('step2')) $('step2').hidden = true;
    busy(true); state('', 'Discovering your business…'); var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) { if (Q.get(k)) utm[k] = Q.get(k); });
    var info = fetch('/api/site-info?url=' + encodeURIComponent(u)).then(function (r) { return r.json(); }).catch(function () { return {}; });
    // Optional capture only when email is present — never block companion on lead form.
    var cap = (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))
      ? fetch('/api/capture' + (DRY ? '?dryRun=1' : ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ website: u, email: em, name: nm, company_fax: $('hp') ? $('hp').value : '', page_url: location.href, referrer: document.referrer, luminary_id: Q.get('l') || '', utm: utm, method: 'form', dryRun: DRY || undefined }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, j: j }; }); }, function () { return { ok: false, j: {} }; })
      : Promise.resolve({ ok: true, j: {} });
    Promise.all([info, cap]).then(function (pair) {
      var i = pair[0] || {}, c = pair[1] || {};
      window.__zenCapture = c.j || {};
      if (!i.ok && !i.siteText) { busy(false); state('err', i.message || i.reason || 'Could not reach that website — try again.'); return; }
      var host = i.host || u.replace(/^https?:\/\//, '').split('/')[0];
      S.host = host; S.businessName = i.businessName || host.replace(/^www\./, ''); S.siteText = i.siteText || ''; S.businessId = i.businessId || null; S.remembered = !!i.remembered; S.msgs = []; log.textContent = '';
      $('zen-title').textContent = 'AI Valet for ' + S.businessName;
      var g = GREETING.replace('{business}', S.businessName);
      bubble('assistant', g); S.msgs.push({ role: 'assistant', content: g });
      busy(false);
      state('ok', i.remembered ? 'Welcome back — I remembered ' + S.businessName + '.' : 'Your chat is ready below.');
      open();
    });
  });
})();
