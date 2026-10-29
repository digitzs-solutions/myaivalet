import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { pushToVendasta, pushContactToVendasta } from '../lib/vendasta.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function decode(s){return s.replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).trim();}
function meta(html,re){const m=html.match(re);return m?decode(m[1]):'';}
function extractName(html,host){
  const og=meta(html,/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)/i)||meta(html,/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name/i);
  if(og) return og;
  for(const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)){
    try{const j=JSON.parse(m[1]);const arr=[].concat(j['@graph']||j);for(const o of arr){if(o&&o.name&&/Organization|Business|Hotel|LodgingBusiness|Restaurant|Store|WebSite|BedAndBreakfast/i.test([].concat(o['@type']).join(' ')))return String(o.name);}}catch{}
  }
  const t=meta(html,/<title[^>]*>([^<]+)/i);
  if(t){const parts=t.split(/\s[|\-–—:]\s/).map(s=>s.trim()).filter(Boolean);if(parts.length)return parts[0];}
  const h=meta(html,/<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g,'').trim(); if(h) return h;
  return host.replace(/^www\./,'').split('.')[0].replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}
function topics(html,name){
  const bad=/^(home|menu|contact|contact us|about|about us|welcome|book now|reserve|login|search|cart|blog|news|more|read more|learn more|skip to content|privacy|terms|gallery|faq|subscribe|follow us|share)$/i;
  const out=[];const seen=new Set();
  for(const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)){let t=decode(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim().replace(/[.!:]+$/,'');
    if(t.length<4||t.length>40||bad.test(t)||t.toLowerCase()===String(name).toLowerCase()||/^(welcome to|copyright|©)/i.test(t))continue;const k=t.toLowerCase();if(seen.has(k))continue;seen.add(k);out.push(t);if(out.length>=3)break;}
  return out;
}
function textOf(html){
  return decode(html.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|section|tr)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}
async function get(url){const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; MyAIValetBot/1.0)','accept':'text/html'},redirect:'follow',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('HTTP '+r.status);return (await r.text()).slice(0,1500000);}

const PHONE_OK=p=>{const d=p.replace(/\D/g,'');return d.length===10||(d.length===11&&d[0]==='1')||(p.trim().startsWith('+')&&d.length>=8&&d.length<=15);};
function normUrl(raw){raw=String(raw||'').trim().slice(0,500);if(raw&&!/^https?:\/\//i.test(raw))raw='https://'+raw;let u;try{u=new URL(raw);}catch{}return (u&&/^https?:$/.test(u.protocol)&&/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname))?u:null;}
async function readSite(u){
  let html='',name='',text='',pages=[],sugg=[];
  try{
    html=await get(u.href); name=extractName(html,u.hostname); text=textOf(html); sugg=topics(html,name); pages.push(u.href);
    const links=[...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m=>{try{return new URL(m[1],u.href).href}catch{return ''}}).filter(h=>h&&new URL(h).hostname===u.hostname&&/about|room|menu|service|contact|faq|amenit|stay|book|visit|hours|event/i.test(h)))].slice(0,4);
    const extra=await Promise.allSettled(links.map(get));
    extra.forEach((r,i)=>{if(r.status==='fulfilled'){text+='\n'+textOf(r.value);pages.push(links[i]);if(sugg.length<3)for(const t of topics(r.value,name))if(sugg.length<3&&!sugg.includes(t))sugg.push(t);}});
  }catch(e){ name=extractName('',u.hostname); }
  return {businessName:name,host:u.hostname,siteText:text.slice(0,30000),pagesRead:pages.length,suggestions:sugg.map(t=>'Ask me about '+t)};
}
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({message:'Method not allowed'});
  let body=req.body; if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}
  const u=normUrl(body?.url);
  if(!u) return res.status(400).json({message:"That doesn't look like a website URL — try something like yourbusiness.com."});
  if(body.step==='read') return res.status(200).json(await readSite(u));
  // step === 'lead'
  const f=k=>String(body?.[k]||'').trim().slice(0,200);
  const lead={firstName:f('firstName'),lastName:f('lastName'),email:f('email'),phone:f('phone'),consent:body?.consent===true};
  if(!lead.firstName||!lead.lastName) return res.status(400).json({message:'Please enter your first and last name.'});
  if(!EMAIL_RE.test(lead.email)) return res.status(400).json({message:'Please enter a valid email address.'});
  if(!PHONE_OK(lead.phone)) return res.status(400).json({message:'Please enter a valid cell phone number.'});
  if(!lead.consent) return res.status(400).json({message:'Please check the box so we can send your concierge to you.'});
  const site=(body.businessName&&typeof body.siteText==='string')?{businessName:f('businessName'),host:u.hostname,siteText:body.siteText.slice(0,30000)}:await readSite(u);
  const now=new Date(), id=randomUUID();
  const rec={id,source:'companion',url:u.href,host:u.hostname,...lead,businessName:site.businessName,submittedAt:now.toISOString(),referrer:String(body.ref||'').slice(0,500),utm:body.utm||{},userAgent:String(req.headers['user-agent']||'').slice(0,300),ip:req.headers['x-forwarded-for']||''};
  console.log('COMPANION_SUBMISSION '+JSON.stringify(rec));
  try{
    await put(`submissions/${now.toISOString().slice(0,10)}/${now.toISOString().replace(/[:.]/g,'-')}_${id}.json`,JSON.stringify(rec,null,2),{access:'private',contentType:'application/json',addRandomSuffix:false});
    await put(`companion-sites/${id}.txt`,site.siteText,{access:'private',contentType:'text/plain',addRandomSuffix:false});
  }catch(e){console.error('BLOB_WRITE_FAILED',e?.message);return res.status(500).json({message:'Something went wrong saving your details — please try again.'});}
  const safe=async fn=>{try{return await fn();}catch(e){console.error('VENDASTA_FAIL',e?.message);return {status:'error'};}};
  const [contact,knowledge]=await Promise.all([safe(()=>pushContactToVendasta({...lead,url:u.href,businessName:site.businessName})),safe(async()=>{ /* HARD RULE Oct 16 2026: full-site crawl for KB */ if(body?.crawlMode==='single') return pushToVendasta({businessName:site.businessName,host:u.hostname,text:site.siteText,crawlMode:'single'}); const {startCaptureJob}=await import('../lib/capturejob.js'); const h=String(req.headers?.['x-forwarded-host']||req.headers?.host||''); const st=await startCaptureJob(u.href,{base:/^[a-z0-9.-]+(:\d+)?$/i.test(h)?'https://'+h:null}); return {status:st.status,job:st.prefix,crawlMode:st.crawlMode}; })]);
  let zap='not_configured'; if(process.env.ZAPIER_LEAD_WEBHOOK_URL){try{const z=await fetch(process.env.ZAPIER_LEAD_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...rec,vendastaContact:contact.status,vendastaKnowledge:knowledge.status}),signal:AbortSignal.timeout(5000)});zap=z.ok?'sent':'error_'+z.status;}catch(e){zap='error';}}
  console.log('VENDASTA_STUB_RESULT '+JSON.stringify({id,contact,knowledge,zapier:zap}));
  return res.status(200).json({id,vendasta:knowledge.status,contact:contact.status});
}
