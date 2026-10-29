import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  let raw = String(body?.url || '').trim().slice(0, 500);
  if (raw && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u; try { u = new URL(raw); } catch {}
  if (!u || !/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname))
    return res.status(400).json({ message: "That doesn't look like a website URL — try something like yourbusiness.com." });
  const now = new Date(); const id = randomUUID();
  const rec = { id, url: u.href, host: u.hostname, submittedAt: now.toISOString(), referrer: String(body.ref||'').slice(0,500), utm: body.utm||{}, userAgent: String(req.headers['user-agent']||'').slice(0,300), ip: req.headers['x-forwarded-for']||'' };
  console.log('SQUEEZE_SUBMISSION ' + JSON.stringify(rec));
  try {
    await put(`submissions/${now.toISOString().slice(0,10)}/${now.toISOString().replace(/[:.]/g,'-')}_${id}.json`, JSON.stringify(rec, null, 2), { access: 'private', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { console.error('BLOB_WRITE_FAILED', e?.message); return res.status(500).json({ message: 'Something went wrong saving your URL — please try again.' }); }
  return res.status(200).json({ message: `Got it! We're building the concierge for ${u.hostname}. Watch your inbox — we'll send your live preview shortly.` });
}
