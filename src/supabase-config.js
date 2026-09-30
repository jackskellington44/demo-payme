import { createClient } from '@supabase/supabase-js';

// Publishable/anon key is safe to ship in browser code; access is enforced by RLS.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  || 'https://kygvlglmguipqtpyjbqp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  || 'sb_publishable_UmABqKGepI7MpJCh5P9K5w_9ZCTQevP';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

// main.js still checks these legacy keys, so keep them in sync with the Supabase session.
supabase.auth.onAuthStateChange((event, session) => {
  try {
    if (session?.access_token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, session.access_token);
    } else if (event === 'SIGNED_OUT') {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(AUTH_USER_KEY);
    }
  } catch {
    // Ignore storage errors in private browsing contexts.
  }
});
