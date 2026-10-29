// Persist / reload website discovery via SECURITY DEFINER RPCs.
// Tables are RLS-locked; anon may only call remember_discovery / get_business_by_host.
import { getSupabase, supabaseConfigured } from './supabase.js';

const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SITE = 30000;

export function isConfigured() {
  return supabaseConfigured();
}

export function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '').trim();
}

export function isFresh(lastDiscoveredAt, withinMs = FRESH_MS) {
  if (!lastDiscoveredAt) return false;
  const t = new Date(lastDiscoveredAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < withinMs;
}

/** Load remembered business by host. Returns null if missing / not configured / error. */
export async function loadByHost(host) {
  const sb = getSupabase();
  if (!sb) return null;
  const h = normalizeHost(host);
  if (!h) return null;
  try {
    const { data, error } = await sb.rpc('get_business_by_host', { p_host: h });
    if (error) {
      console.error('REMEMBER_LOAD_ERR', error.message);
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) {
    console.error('REMEMBER_LOAD_THROW', e.message);
    return null;
  }
}

/**
 * Save a discovery result.
 * pages: [{ url, title, text }]
 * Returns { id, host, ... } or null.
 */
export async function saveDiscovery({ host, url, name, siteText, pages = [] }) {
  const sb = getSupabase();
  if (!sb) return null;
  const h = normalizeHost(host);
  if (!h) return null;
  const cleanPages = (Array.isArray(pages) ? pages : []).slice(0, 40).map(p => ({
    url: String(p.url || '').slice(0, 2000),
    title: String(p.title || '').slice(0, 500),
    text: String(p.text || p.content || '').slice(0, 15000),
  }));
  try {
    const { data, error } = await sb.rpc('remember_discovery', {
      p_host: h,
      p_url: String(url || '').slice(0, 2000),
      p_name: String(name || '').slice(0, 120),
      p_site_text: String(siteText || '').slice(0, MAX_SITE),
      p_pages: cleanPages,
    });
    if (error) {
      console.error('REMEMBER_SAVE_ERR', error.message);
      return null;
    }
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    console.error('REMEMBER_SAVE_THROW', e.message);
    return null;
  }
}
