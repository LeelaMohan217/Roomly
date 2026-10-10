import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Push registration.
 *
 * Deliberately silent when push isn't configured. Getting an Expo push token
 * needs an EAS projectId, and delivery needs FCM credentials on Android or an
 * APNs key on iOS — if any is missing this no-ops and the in-app feed carries on. A half-set-up
 * app should not nag or crash.
 *
 * Also inert in Expo Go: remote push was removed there for Android from SDK
 * 53, so this only does anything in a development build or the APK.
 */

// Foreground behaviour: show the banner, since a housemate adding a ₹600
// expense while you're staring at the balance is exactly when you want to know.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function resolveProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

/** True when this build could actually deliver a push. */
export function isPushConfigured(): boolean {
  return !!resolveProjectId();
}

export type PushState =
  /** No EAS projectId in this build, so no token can ever be issued. */
  | 'not-set-up'
  /** Simulator or web: cannot receive a push however well configured. */
  | 'unsupported'
  /** Configured, but the person said no to the OS prompt. */
  | 'blocked'
  /** Configured and permitted, but no token registered yet this session. */
  | 'pending'
  | 'on';

/**
 * Why push is or is not working on THIS device.
 *
 * Registration is deliberately silent -- a half-configured app should not nag
 * -- but silence is indistinguishable from "quietly broken", which is how push
 * sat unnoticed for weeks. This is the one place that says which it is.
 */
export function usePushStatus(): PushState {
  const [state, setState] = useState<PushState>('pending');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!resolveProjectId()) {
        if (!cancelled) setState('not-set-up');
        return;
      }
      if (!Device.isDevice || Platform.OS === 'web') {
        if (!cancelled) setState('unsupported');
        return;
      }

      const perms = await Notifications.getPermissionsAsync();
      if (cancelled) return;

      if (!perms.granted) {
        setState(perms.canAskAgain ? 'pending' : 'blocked');
        return;
      }

      // Permission alone is not delivery: FCM can still be misconfigured, and
      // that only shows up when a token is actually requested.
      try {
        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId: resolveProjectId()!,
        });
        if (!cancelled) setState(token ? 'on' : 'blocked');
      } catch {
        if (!cancelled) setState('blocked');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export const PUSH_LABELS: Record<PushState, { value: string; hint: string }> = {
  'not-set-up': {
    value: 'Off',
    hint: 'This build has no push credentials. See PUSH-SETUP.md',
  },
  unsupported: { value: 'Off', hint: 'Only a real phone can receive these' },
  blocked: {
    value: 'Blocked',
    hint: `Turn notifications on in ${Platform.OS === 'ios' ? 'iPhone' : 'Android'} settings`,
  },
  pending: { value: 'Asking', hint: 'Waiting for permission' },
  // Deliberately says "registered", not "working": a token proves this device
  // can be addressed, not that Expo holds the FCM key needed to deliver.
  on: { value: 'On', hint: 'This device is registered for notifications' },
};

export function usePushRegistration() {
  const { member } = useSession();

  useEffect(() => {
    if (!member) return;

    let cancelled = false;

    void (async () => {
      // Emulators can't receive push, and asking for permission there just
      // trains people to dismiss the prompt.
      if (!Device.isDevice) return;

      const projectId = resolveProjectId();
      if (!projectId) return;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Household activity',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 200, 100, 200],
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      const granted =
        existing.granted ||
        (await Notifications.requestPermissionsAsync()).granted;

      if (!granted || cancelled) return;

      try {
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled || !token) return;

        await supabase.rpc('register_push_token', {
          p_token: token,
          p_platform: Platform.OS,
        });
      } catch {
        // No token available (misconfigured FCM, no network). The feed still
        // works; there is nothing useful to tell the user here.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [member]);
}
