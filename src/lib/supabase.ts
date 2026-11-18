import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing Supabase env vars. Copy .env.example to .env and fill it in.');
}

/**
 * Told whenever a database or storage request went out WITHOUT a signed-in
 * token and the server answered it.
 *
 * supabase-js never says when it cannot get a live session: it quietly sends
 * the public key instead. The server then treats the person as a stranger --
 * reads come back empty and writes are refused with "permission denied" --
 * while the app, which still holds the old session, carries on as if signed
 * in. That is how members were asked for a phone number they had already
 * saved, and then told they had no permission to save it.
 *
 * Only reported after a response arrives, so being offline never looks like
 * this. SessionProvider decides what it means: on the sign-in screen a
 * signed-out request is normal; inside the app it is a session that has died.
 */
type AnonymousListener = () => void;
const anonymousListeners = new Set<AnonymousListener>();

export function onAnonymousRequest(listener: AnonymousListener): () => void {
  anonymousListeners.add(listener);
  return () => {
    anonymousListeners.delete(listener);
  };
}

const watchedPaths = ['/rest/v1/', '/storage/v1/'];

const watchingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  try {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (watchedPaths.some((path) => target.includes(path))) {
      const auth = new Headers(init?.headers).get('Authorization');
      // No header at all is the same stranger, with a publishable-style key.
      if (!auth || auth === `Bearer ${anonKey}`) {
        anonymousListeners.forEach((listener) => listener());
      }
    }
  } catch {
    // Watching must never break the request it watches.
  }
  return response;
};

export const supabase = createClient(url, anonKey, {
  global: { fetch: watchingFetch },
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
