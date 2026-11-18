import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Linking from 'expo-linking';
import { DefaultTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { BrandSplash } from '@/components/brand/splash';
import { DialogProvider } from '@/components/ui/dialog';
import { AppFonts } from '@/constants/fonts';
import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { recoveryStarted, setRecoveryPending, useRecoveryPending } from '@/lib/recovery';
import { SessionProvider, useSession } from '@/lib/session';
import { SyncProvider } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

/**
 * Tell React Query when the app comes back to the foreground, so anything
 * stale (older than staleTime) refetches.
 *
 * Its default focus signal is the browser's visibilitychange event, which
 * React Native never fires -- so on a phone it never refetched on return.
 * Android drops the Realtime socket in the background and nothing replays
 * what housemates did meanwhile, and the tab screens stay mounted, so Home,
 * History and Reports kept showing the numbers from before you left until a
 * pull to refresh. The web build keeps the browser's own signal.
 */
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });
}

const DAY = 1000 * 60 * 60 * 24;

export default function RootLayout() {
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

  // Light-only: the phone's dark mode setting is ignored.
  return (
    <ThemeProvider value={DefaultTheme}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 7 * DAY }}>
        <SessionProvider>
          <SyncProvider>
            <DialogProvider>
              <RootNavigator />
            </DialogProvider>
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
  const { status, resolving } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const url = Linking.useURL();
  const handledUrl = useRef<string | null>(null);
  const recoveryPending = useRecoveryPending();
  const theme = useTheme();
  // The app typeface, from files in the bundle. A failure to load is not a
  // reason to hold the app: text falls back to the system font.
  const [fontsLoaded, fontError] = useFonts(AppFonts);
  // The reset flag is read from storage at launch; until it is known the app
  // cannot tell whether to land on the new-password form.
  const booting =
    status === 'loading' || recoveryPending === null || (!fontsLoaded && !fontError);

  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync();
  }, [booting]);

  /**
   * A reset link signed this person in and they have not chosen a password
   * yet: keep them on "Choose a new password" -- after Back, after a restart,
   * from anywhere -- until they save one or sign out.
   *
   * Signed out with the flag still set means it is stale (the session ended
   * some other way), so it is dropped -- but never while reset-password is
   * showing, which is where a link is verified before the session arrives.
   */
  useEffect(() => {
    if (booting || !recoveryPending || pathname === '/reset-password') return;
    if (status === 'signedOut') void setRecoveryPending(false);
    else router.replace('/reset-password');
  }, [booting, recoveryPending, status, pathname, router]);

  /**
   * The password-reset link, delivered by hand.
   *
   * On a cold start the link arrives while this component is still showing
   * the brand screen below instead of the Stack, and expo-router's own
   * handling of it was lost: the app opened on sign in, the code never reached
   * reset-password, and the reset email did nothing. So once the session is
   * known, and the Stack is mounted to navigate in, read the URL the app was
   * opened with and go there ourselves.
   *
   * Each URL is handled once, and not at all when reset-password is already
   * showing -- the warm-start case expo-router does handle. The code is single
   * use, so opening the screen a second time with it would burn it and show
   * "This link didn't work".
   */
  useEffect(() => {
    if (booting || !url || handledUrl.current === url) return;

    const link = Linking.parse(url);
    // roomly:///reset-password puts it in the path; roomly://reset-password
    // in the hostname. Accept either.
    const target = `${link.hostname ?? ''}/${link.path ?? ''}`;
    if (!target.includes('reset-password')) return;

    const code = typeof link.queryParams?.code === 'string' ? link.queryParams.code : undefined;
    const tokenHash =
      typeof link.queryParams?.token_hash === 'string' ? link.queryParams.token_hash : undefined;
    if (!code && !tokenHash) return;

    handledUrl.current = url;
    // Already on it, or the router's own copy of the screen has started
    // verifying -- in which case opening another would only be a second
    // screen waiting on the same answer.
    if (pathname === '/reset-password' || recoveryStarted({ code, tokenHash })) return;

    router.replace({
      pathname: '/reset-password',
      params: code ? { code } : { token_hash: tokenHash!, type: 'recovery' },
    });
  }, [booting, url, pathname, router]);

  // While the session is still being worked out, the brand screen -- the
  // same green and wordmark as the native splash -- rather than nothing. The
  // native splash is hidden the moment this has drawn underneath it, so the
  // wait looks like one screen, then sign in or home.
  if (booting) {
    return <BrandSplash onLayout={() => void SplashScreen.hideAsync()} />;
  }

  return (
    <>
    {/* Every screen is drawn in one centred column, capped at MaxContentWidth,
        with the page colour either side. On a phone the column is the whole
        screen; on a tablet or a landscape window it stops the phone layouts
        stretching edge to edge. Done here once, not per screen, so a new
        screen can't forget it. */}
    <View style={[styles.page, { backgroundColor: theme.background }]}>
    <View style={styles.column}>
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
    </View>
    </View>

    {/* Just signed in, household not known yet: the brand screen over the
        Stack while the guards settle underneath, so sign in goes straight to
        Home instead of flashing "Create a household / Join with a code" for
        the second the membership read takes. Over it, not instead of it, so
        the Stack -- and a reset-password screen mid-verification -- stays
        mounted; and not on that screen, which has its own progress state. */}
    {resolving && pathname !== '/reset-password' ? (
      <View style={StyleSheet.absoluteFill}>
        <BrandSplash />
      </View>
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
});
