import assert from 'node:assert'; import fs from 'node:fs'; import vm from 'node:vm';
const ctx={}; ctx.window=ctx; vm.runInNewContext(fs.readFileSync(new URL('../chat/dictation.js',import.meta.url),'utf8'),ctx);
const { createDictation } = ctx.ZenDictation;
const R=(t,f)=>Object.assign([{transcript:t}],{isFinal:f});
const ev=(i,...rs)=>({resultIndex:i,results:rs});
const d=createDictation('');
assert.equal(d.onResult(ev(0,R('homes',false))),'homes');
assert.equal(d.onResult(ev(0,R('homes for sale',false))),'homes for sale');
assert.equal(d.onResult(ev(0,R('homes for sale',true))),'homes for sale');
// Android-style repeated final event for same index must not duplicate
assert.equal(d.onResult(ev(0,R('homes for sale',true))),'homes for sale');
assert.equal(d.onResult(ev(1,R('homes for sale',true),R('from Meredith',false))),'homes for sale from Meredith');
assert.equal(d.onResult(ev(1,R('homes for sale',true),R('from Meredith Fine Properties',true))),'homes for sale from Meredith Fine Properties');
assert.equal(d.finalText(),'homes for sale from Meredith Fine Properties');
for(let k=0;k<100;k++) d.onResult(ev(1,R('homes for sale',true),R('from Meredith Fine Properties',true)));
assert.equal(d.finalText(),'homes for sale from Meredith Fine Properties');
assert.equal(createDictation('Hi').onResult(ev(0,R('there',true))),'Hi there');
console.log('dictation ok');
