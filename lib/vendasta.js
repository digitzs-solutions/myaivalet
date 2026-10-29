// Vendasta AI Knowledge API adapter. DISABLED unless every env var below is set AND VENDASTA_WRITE_ENABLED === 'true'.
// Env: VENDASTA_SERVICE_ACCOUNT_JSON ({client_email|client_id, private_key, token_uri}), VENDASTA_PARTNER_ID,
//      VENDASTA_ACCOUNT_ID (e.g. the MyAiValet AG-…), VENDASTA_CHAT_RECEPTIONIST_ID (Chat Receptionist ASSISTANT-…),
//      VENDASTA_API_BASE (default https://prod.apigateway.co/grpc), VENDASTA_WRITE_ENABLED.
// Payload shape follows the public Knowledge API v2 OpenAPI (POST /v1/knowledge/upsert); verify against a sandbox before enabling.
import { createSign } from 'node:crypto';
const b64u = s => Buffer.from(s).toString('base64url');
export function vendastaConfigured(){
  const e=process.env; return !!(e.VENDASTA_SERVICE_ACCOUNT_JSON&&e.VENDASTA_PARTNER_ID&&e.VENDASTA_ACCOUNT_ID&&e.VENDASTA_CHAT_RECEPTIONIST_ID);
}
export async function token(scope='knowledge'){
  // Vendasta service-account JSON carries assertionHeaderData/assertionPayloadData (aud=https://iam-prod.apigateway.co); fall back to generic fields.
  const sa=JSON.parse(process.env.VENDASTA_SERVICE_ACCOUNT_JSON); const now=Math.floor(Date.now()/1000);
  const tokenUri=sa.token_uri||'https://sso-api-prod.apigateway.co/oauth2/token';
  const hd={alg:'RS256',typ:'JWT',kid:sa.private_key_id,...(sa.assertionHeaderData||{})};
  const pd=sa.assertionPayloadData||{iss:sa.client_email||sa.client_id,sub:sa.client_email||sa.client_id,aud:tokenUri};
  const head=b64u(JSON.stringify(hd)), claims=b64u(JSON.stringify({...pd,iat:now,exp:now+300,scope}));
  const sig=createSign('RSA-SHA256').update(head+'.'+claims).sign(sa.private_key,'base64url');
  const r=await fetch(tokenUri,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${head}.${claims}.${sig}`,scope})});
  if(!r.ok) throw new Error('token '+r.status); return (await r.json()).access_token;
}
// HARD RULE (Oct 16 2026): single-text (homepage) KB source is allowed ONLY with explicit crawlMode:'single'. Default path = full-site capture job.
export async function pushToVendasta({businessName,host,text,crawlMode}){
  if(crawlMode!=='single') return {status:'blocked_full_site_rule',use:'startCaptureJob'};
  if(!vendastaConfigured()) return {status:'not_configured'};
  if(process.env.VENDASTA_WRITE_ENABLED!=='true') return {status:'write_disabled'};
  const base=process.env.VENDASTA_API_BASE||'https://prod.apigateway.co/grpc';
  // Shape per Knowledge API v2 OpenAPI (v2UpsertKnowledgeRequest): flat name + content.text.text; accountGroupId XOR partnerId.
  const body={accountGroupId:process.env.VENDASTA_ACCOUNT_ID,assistantId:process.env.VENDASTA_CHAT_RECEPTIONIST_ID,
    name:`Prospect – ${businessName} (${host})`.slice(0,500),content:{text:{text:text.slice(0,100000)}}};
  const r=await fetch(base+'/v1/knowledge/upsert',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await token()},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok) return {status:'error',code:r.status};
  const j=await r.json().catch(()=>({})); return {status:'synced',knowledgeSourceId:j.knowledgeSourceId||j.id||j.knowledgeSourceId||j.knowledge?.id||null};
}

// CRM contact create on the MyAiValet account. Endpoint path is UNVERIFIED (set VENDASTA_CRM_CONTACT_PATH once confirmed in Vendasta's CRM API docs).
export async function pushContactToVendasta(lead){
  if(!vendastaConfigured()) return {status:'not_configured'};
  if(process.env.VENDASTA_WRITE_ENABLED!=='true') return {status:'write_disabled'};
  const base=process.env.VENDASTA_API_BASE||'https://prod.apigateway.co/grpc';
  const path=process.env.VENDASTA_CRM_CONTACT_PATH||'/v1/crm/contact/create';
  const body={partnerId:process.env.VENDASTA_PARTNER_ID,namespace:process.env.VENDASTA_ACCOUNT_ID,
    contact:{firstName:lead.firstName,lastName:lead.lastName,email:lead.email,phoneNumber:lead.phone,website:lead.url,companyName:lead.businessName,
      tags:['myaivalet-companion'],smsConsent:!!lead.consent,source:'MyAIValet Companion'}};
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await token()},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok) return {status:'error',code:r.status};
  const j=await r.json().catch(()=>({})); return {status:'synced',contactId:j.id||j.contactId||null};
}
