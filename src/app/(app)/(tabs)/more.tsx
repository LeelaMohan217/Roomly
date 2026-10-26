import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

type Row = {
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  tint: 'primary' | 'plain';
};

export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  // Owners get one door into everything they administer, rather than the
  // same four links scattered across three screens.
  const rows: Row[] = [
    ...(isOwner
      ? ([
          {
            href: '/owner',
            icon: 'construct',
            label: 'Owner tools',
            hint: 'People, categories and monthly bills',
            tint: 'primary',
          },
        ] as Row[])
      : ([
          {
            href: '/household',
            icon: 'people',
            label: 'Household',
            hint: 'Who lives here',
            tint: 'plain',
          },
        ] as Row[])),
    {
      href: '/settle',
      icon: 'swap-horizontal',
      label: 'Settle up',
      hint: 'Who pays whom, and closing the month',
      tint: 'plain',
    },
    {
      href: '/away',
      icon: 'airplane',
      label: 'Away calendar',
      hint: 'Mark a trip so day-to-day costs split without you',
      tint: 'plain',
    },
    {
      href: '/recurring',
      // "Bills", matching the Home button that opens the same screen.
      icon: 'calendar',
      label: 'Bills',
      hint: 'Rent, wifi and other bills that post themselves each month',
      tint: 'plain',
    },
    {
      href: '/edit-history',
      icon: 'document-text',
      label: 'Edit history',
      hint: 'Every change to an expense or payment, and who made it',
      tint: 'plain',
    },
    {
      href: '/settings',
      icon: 'person-circle',
      label: 'Account',
      hint: 'Your profile and sign out',
      tint: 'plain',
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <AppBar title="More" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card padded={false}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={() => router.push(r.href)}
              style={({ pressed }) => [
                styles.row,
                i < rows.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.border,
                },
                { opacity: pressed ? 0.6 : 1 },
              ]}>
              <View
                style={[
                  styles.tile,
                  {
                    backgroundColor:
                      r.tint === 'primary' ? theme.primarySoft : theme.backgroundSelected,
                  },
                ]}>
                <Ionicons
                  name={r.icon}
                  size={19}
                  color={r.tint === 'primary' ? theme.primary : theme.textSecondary}
                />
              </View>

              <View style={styles.rowText}>
                <ThemedText style={Type.body}>{r.label}</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {r.hint}
                </ThemedText>
              </View>

              <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: 130, gap: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
});
