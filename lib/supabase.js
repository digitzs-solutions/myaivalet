// Server-side Supabase client for MyAIValet squeeze.
// Reads ONLY the configured Vercel env vars (no secrets hardcoded).
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

function envUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}

function envKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY
    || '';
}

export function supabaseConfigured() {
  return Boolean(envUrl() && envKey());
}

function realtimeOpts() {
  if (typeof globalThis.WebSocket !== 'undefined') return {};
  try {
    const require = createRequire(import.meta.url);
    const ws = require('ws');
    return { realtime: { transport: ws } };
  } catch {
    return {};
  }
}

let _client = null;
export function getSupabase() {
  const url = envUrl();
  const key = envKey();
  if (!url || !key) return null;
  if (_client) return _client;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeOpts(),
  });
  return _client;
}
