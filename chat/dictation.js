// Pure dictation state machine (testable). Builds ONE string: base + finals (+ interim), using resultIndex.
(function(g){
  function createDictation(base){
    var finals=[],interim='';base=(base||'').trim();
    return {
      onResult:function(e){interim='';
        for(var i=e.resultIndex||0;i<e.results.length;i++){var r=e.results[i],t=(r[0]&&r[0].transcript||'').trim();if(!t)continue;
          if(r.isFinal){finals[i]=t}else interim+=(interim?' ':'')+t}
        return this.text(true)},
      text:function(withInterim){var p=[base].concat(finals.filter(Boolean));if(withInterim&&interim)p.push(interim);return p.filter(Boolean).join(' ')},
      finalText:function(){return this.text(false)}
    }}
  g.ZenDictation={createDictation:createDictation};
  if(typeof module!=='undefined')module.exports={createDictation:createDictation};
})(typeof window!=='undefined'?window:globalThis);
