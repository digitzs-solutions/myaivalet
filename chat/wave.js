// Live waveform: mic via Web Audio AnalyserNode (real level, drives barge-in); assistant speech is drawn as a
// synthetic wave pulsed by speechSynthesis word-boundary events (browsers don't expose TTS audio to Web Audio).
(function (g) {
  function createWave(canvas) {
    var ctx = canvas.getContext('2d'), mode = 'idle', an = null, buf = null, stream = null, ac = null, raf = 0, pulse = 0, onLevel = null;
    function draw() { raf = requestAnimationFrame(draw); var w = canvas.width = canvas.clientWidth * (g.devicePixelRatio || 1), h = canvas.height = canvas.clientHeight * (g.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h); ctx.lineWidth = 2 * (g.devicePixelRatio || 1); ctx.strokeStyle = mode === 'speaking' ? '#16a34a' : mode === 'listening' ? '#7c3aed' : '#c4b5fd'; ctx.beginPath();
      var lvl = 0; if (an) { an.getByteTimeDomainData(buf); for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; lvl = Math.max(lvl, Math.abs(v)); } if (onLevel) onLevel(lvl); }
      var t = performance.now() / 1000; pulse *= 0.93;
      for (var x = 0; x <= w; x += 3) { var y;
        if (mode === 'listening' && an) { var k = Math.floor(x / w * (buf.length - 1)); y = h / 2 + (buf[k] - 128) / 128 * h * 0.9; }
        else if (mode === 'speaking') y = h / 2 + Math.sin(x / 14 + t * 9) * h * (0.12 + pulse * 0.3) * Math.sin(Math.PI * x / w);
        else if (mode === 'thinking') y = h / 2 + Math.sin(x / 20 + t * 4) * h * 0.06;
        else y = h / 2;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    return {
      mic: function () { if (stream) return Promise.resolve(true); var md = navigator.mediaDevices; if (!md || !md.getUserMedia) return Promise.resolve(g.isSecureContext === false ? 'insecure' : 'unsupported');
        return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (s) { stream = s;
          ac = new (g.AudioContext || g.webkitAudioContext)(); an = ac.createAnalyser(); an.fftSize = 1024; buf = new Uint8Array(an.fftSize); ac.createMediaStreamSource(s).connect(an); return true; }, function (e) { return (e && e.name) || 'error'; }); },
      set: function (m) { mode = m; if (!raf) draw(); }, pulse: function () { pulse = 1; }, onLevel: function (f) { onLevel = f; },
      stop: function () { mode = 'idle'; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; an = null; if (ac) try { ac.close(); } catch (e) {} ac = null; }
    };
  }
  g.ZenWave = { createWave: createWave };
})(typeof window !== 'undefined' ? window : globalThis);
