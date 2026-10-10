import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing Supabase env vars. Copy .env.example to .env and fill it in.');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No URL-based session detection on native; password reset arrives
    // through the roomly:// deep link and is handled explicitly.
    detectSessionInUrl: false,
    // PKCE delivers the recovery code as a query parameter, which the router
    // exposes directly. The implicit flow puts tokens in a URL fragment,
    // which never reaches JavaScript on a native deep link.
    flowType: 'pkce',
  },
});

// Without this the access token silently goes stale while the app is
// backgrounded, and the first sync after reopening fails with a 401.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
