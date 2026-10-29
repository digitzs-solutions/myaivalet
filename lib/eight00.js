// 800.com KB push (best-effort): website URL -> KB document (url source) -> link to agent 799 (GET ZEN LIVE DEMO, 855 line).
// Only POST create + POST link. Never calls update/delete endpoints; skips URLs that already exist as documents.
const API = 'https://api.800.com', COMPANY = 464024, AGENT = 799;
const norm = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return String(u || '').toLowerCase(); } };
export function businessName(p = {}) { const n = String(p.business_name || '').trim(); return (n || p.website_host || 'Website').slice(0, 200); }
export async function pushTo800(url, name, { token = process.env.EIGHT00_API_TOKEN, fetchFn = fetch, company = COMPANY, agentId = AGENT, checkExisting = true } = {}) {
  if (!token) return { ok: false, skipped: 'no_token' };
  if (!url) return { ok: false, skipped: 'no_url' };
  const h = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' };
  const call = async (path, opts = {}) => { const r = await fetchFn(API + path, { headers: h, signal: AbortSignal.timeout(10000), ...opts });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} if (!r.ok) throw Object.assign(new Error(`800 ${opts.method || 'GET'} ${path.split('/').slice(-2).join('/')} ${r.status}`), { status: r.status }); return j; };
  const base = `/companies/${company}/knowledge-base/documents`;
  if (checkExisting) { try { const want = norm(url);
      for (let page = 1; page <= 5; page++) { const j = await call(`${base}?page=${page}&perPage=100`); const list = j?.data || j?.documents || (Array.isArray(j) ? j : []);
        const hit = list.find(d => norm(d.url || d.source?.url || d.sourceUrl) === want); if (hit) return { ok: true, skipped: 'exists', id: hit.id };
        const last = j?.meta?.last_page ?? j?.meta?.lastPage ?? j?.last_page; if (!list.length || !last || page >= last) break; }
    } catch (e) { /* list failed: continue to create */ } }
  const doc = await call(`${base}/url`, { method: 'POST', body: JSON.stringify({ url, name, recrawlIntervalDays: 7, autoRemoveOn404: true }) });
  const id = doc?.data?.id ?? doc?.id; if (!id) throw new Error('800 create: no id');
  await call(`${base}/${id}/agents`, { method: 'POST', body: JSON.stringify({ agentIds: [agentId] }) });
  return { ok: true, id, linked: [agentId] };
}
export function pushTo800Logged(url, name, opts) {
  return pushTo800(url, name, opts).then(r => { console.log('EIGHT00_KB_PUSH ' + JSON.stringify(r)); return r; },
    e => { console.error('EIGHT00_KB_PUSH_FAILED ' + e.message); return { ok: false, error: e.message }; });
}
