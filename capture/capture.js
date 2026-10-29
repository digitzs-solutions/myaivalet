// Drop-in client: <script src="https://myaivalet.getondeets.ai/capture/capture.js" data-endpoint="https://myaivalet.getondeets.ai/api/capture"></script>
// + a form with id="capture-form" (or data-myaivalet-capture). data-endpoint defaults to /api/capture on the script's own origin.
(function(){
  var me = document.currentScript, EP = (me && me.getAttribute('data-endpoint')) || (me && me.src ? new URL('/api/capture', me.src).href : '/api/capture');
  var FORM_ID = (me && me.getAttribute('data-form')) || 'capture-form';
  var q = new URLSearchParams(location.search), utm = {};
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){ if(q.get(k)) utm[k]=q.get(k); });
  var geo = new Promise(function(res){ if(!navigator.geolocation) return res({}); var t=setTimeout(function(){res({});},5000);
    navigator.geolocation.getCurrentPosition(function(p){clearTimeout(t);res({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy});},function(){clearTimeout(t);res({});},{timeout:5000,maximumAge:600000}); });
  function send(extra){ return geo.then(function(g){ return post(Object.assign({}, g, extra)); }); }
  function post(extra){ var b = Object.assign({ page_url: location.href, referrer: document.referrer, luminary_id: q.get('l')||'', utm: utm }, extra);
    return fetch(EP,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json();}); }
  window.MyAiValetCapture = send;
  // Redirect capture: any page loaded with ?site=... submits automatically (once per session per site).
  var site = q.get('site');
  if (site && !sessionStorage.getItem('cap:'+site)) { sessionStorage.setItem('cap:'+site,'1'); send({ website: site, method: 'redirect' }); }
  // Delegated listener: works even if the form is rendered later (React/Vibe). Matches id=FORM_ID or [data-myaivalet-capture].
  document.addEventListener('submit', function(e){ var f = e.target; if(!f || !(f.id === FORM_ID || f.hasAttribute('data-myaivalet-capture'))) return;
    e.preventDefault(); var d = Object.fromEntries(new FormData(f)), m = f.querySelector('[data-msg]'), btn = f.querySelector('[type=submit]');
    d.method='form'; if(btn) btn.disabled = true;
    send(d).then(function(r){ if(m) m.textContent=r.message; if(r.ok) f.reset(); }).catch(function(){ if(m) m.textContent='Please try again.'; })
      .then(function(){ if(btn) btn.disabled = false; }); }, true);
})();
