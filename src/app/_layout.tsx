import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

// One source of truth for the colour scheme. The navigator theme and the
// design tokens reading different hooks is how you get light cards on a dark
// page.
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider, useSession } from '@/lib/session';
import { SyncProvider } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

const DAY = 1000 * 60 * 60 * 24;

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cached data has to outlive the session for the app to show
            // anything useful offline; the default 5 minutes would evict it
            // before it was ever written to storage.
            gcTime: 7 * DAY,
            staleTime: 30_000,
            // Serve cache first and still attempt the network, rather than
            // refusing to run when React Query thinks we're offline.
            networkMode: 'offlineFirst',
            retry: 2,
          },
        },
      })
  );

  const [persister] = useState(() => createAsyncStoragePersister({ storage: AsyncStorage }));

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 7 * DAY }}>
        <SessionProvider>
          <SyncProvider>
            <RootNavigator />
          </SyncProvider>
        </SessionProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  );
}

/**
 * One place decides what you can see. Session status maps straight onto the
 * route guards, so there is no scattered "if (!user) redirect" to get wrong.
 *
 * Only (app) contains an index route — auth and onboarding use named routes so
 * that no two groups both claim "/".
 */
function RootNavigator() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* The first screen declared under a passing guard is where the app
          lands. React Navigation's StackRouter falls back to routeNames[0]
          whenever the current route is not renderable — getInitialState,
          getRehydratedState and getStateForRouteNamesChange all do it — so
          declaration order here is load-bearing, not cosmetic. */}
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>

      <Stack.Protected guard={status === 'needsOnboarding'}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="create-household" />
        <Stack.Screen name="join-household" />
      </Stack.Protected>

      <Stack.Protected guard={status === 'waiting'}>
        <Stack.Screen name="waiting" />
      </Stack.Protected>

      <Stack.Protected guard={status === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      {/* Outside every guard on purpose: verifying a recovery link signs the
          user in, so a guarded reset screen would be torn away the instant
          the link worked — before they chose a new password.

          Declared LAST so it is never routeNames[0], and so never the
          router's fallback. It used to be first, which made it the landing
          screen for every unmatched route: a cold launch while signed out
          showed "Link didn't work", and signing in showed "Choose a new
          password". Because it stays in routeNames under every status, it
          also survives the guard swap when verification signs the user in. */}
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
