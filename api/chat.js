import { loadByHost, normalizeHost } from '../lib/remember.js';

function chunks(text){return [...new Set(text.split(/\n+/).map(s=>s.trim()).filter(s=>s.length>30))];}
function retrieve(text,q,k=3){const words=q.toLowerCase().match(/[a-z0-9]{3,}/g)||[];const stop=new Set(['the','and','you','your','what','how','are','for','can','have','with','does','this','that','about','there','any','tell']);const w=words.filter(x=>!stop.has(x));
  return chunks(text).map(c=>{const l=c.toLowerCase();return [w.reduce((s,x)=>s+(l.includes(x)?1:0),0),c];}).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]).slice(0,k).map(x=>x[1].slice(0,400));}
// Off-topic guard: question names another domain/business than the one we're scoped to.
const DOM_RE = /\b((?:[a-z0-9-]+\.)+(?:com|net|org|ai|io|co|us|biz|info|app|dev|shop|store|site|online|uk|ca|me|tv|xyz))\b/gi;
export function hostFromSiteText(text) { const m = String(text || '').match(/https?:\/\/([^/\s]+)/i); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; }
export function offTopicDomain(q, host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, ''); const base = h.split('.').slice(-2).join('.');
  for (const m of String(q || '').matchAll(DOM_RE)) { const d = m[1].toLowerCase().replace(/^www\./, ''); if (!h || !(d === h || d.endsWith('.' + base) || d === base)) return d; }
  return ''; }
export function offTopicReply(name, d) { return `I only know about ${name}, so I can't tell you about ${d}. I'd be happy to help with anything about ${name}. What would you like to know?`; }
// Opening greeting (keep identical to chat/zen.js GREETING). {business} = visitor's business name.
export const GREETING = "Hi, I'm the AI Valet for {business}. I'd love to, would you like me to share what we do?";
export const greetingFor = n => GREETING.replace('{business}', n);
// Audio / voice / meta problems: answer helpfully instead of quoting site text.
export const AUDIO_RE = /\b(can'?t|cannot|can ?not|couldn'?t|don'?t|not)\s+(hear|listen)|\bno (sound|audio|voice)|\b(mic|microphone)\b|\b(sound|audio|volume)\b.*\b(not|isn.?t|doesn.?t|won.?t|off|broken|working)\b|\bvoice\b.*\b(not|isn'?t|doesn'?t|won'?t|broken|working)/i;
export const AUDIO_REPLY = "Sorry about that! Voice works best in Chrome on a computer. On iPhone, tap the mic, allow microphone access, and make sure your phone isn't on silent with the volume up, or just type here and I'll answer.";

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({message:'Method not allowed'});
  let b=req.body; if(typeof b==='string'){try{b=JSON.parse(b);}catch{b={};}}
  let name=String(b.businessName||'this business').slice(0,120);
  let text=String(b.siteText||'').slice(0,30000);
  let host=normalizeHost(b.host||'');
  let fromDb=false;

  // Prefer Supabase when client sent no siteText but has host or businessId
  if(!text.trim() && (host || b.businessId)){
    try{
      const row=await loadByHost(host||'');
      if(row && row.site_text){
        text=String(row.site_text).slice(0,30000);
        if(!name||name==='this business') name=String(row.display_name||host||'this business').slice(0,120);
        if(!host) host=normalizeHost(row.host||'');
        fromDb=true;
      }
    }catch(e){ console.error('CHAT_REMEMBER_LOAD', e.message); }
  }

  const history=(Array.isArray(b.messages)?b.messages:[]).slice(-12).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,2000)}));
  const q=history.filter(m=>m.role==='user').pop()?.content||'';
  // LOCAL RETRIEVAL FALLBACK (demo mode): no external AI. Quotes the most relevant passages from the visitor's own site.
  if(/^\s*(hi|hello|hey|hiya|howdy|yo|good (morning|afternoon|evening))\b[\s\w!.,]{0,20}$/i.test(q)) return res.status(200).json({reply:greetingFor(name),mode:'greeting',fromDb});
  if(AUDIO_RE.test(q)) return res.status(200).json({reply:AUDIO_REPLY,mode:'audio-help',fromDb});
  const other=offTopicDomain(q, host||hostFromSiteText(text));
  if(other) return res.status(200).json({reply:offTopicReply(name,other),mode:'off-topic',fromDb});
  if(!text.trim()) return res.status(200).json({reply:`I'm getting ready to help with ${name}. Give me a few seconds and ask again.`,mode:'no-context',fromDb});
  const hits=retrieve(text,q);
  const reply=hits.length?`Here's what ${name}'s website says:\n\n“${hits.join('”\n\n“')}”`:`I couldn't find that on ${name}'s website. The best bet is to contact ${name} directly.`;
  return res.status(200).json({reply,mode:'local-retrieval-fallback',fromDb});
}
