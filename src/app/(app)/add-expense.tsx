import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpenseForm, type ExpenseFormValues } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { committed, rejected } from '@/lib/haptics';
import { useCategories, useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync';

export default function AddExpenseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const { submitExpense, online } = useSync();

  // The calculator hands its total over as a param. Everything else about the
  // form is untouched, so this is additive -- opening Add Expense normally
  // just leaves it undefined.
  const params = useLocalSearchParams<{ amount?: string }>();

  const categories = useCategories();
  const members = useMembers();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(values: ExpenseFormValues) {
    setError(null);
    setBusy(true);

    // Names are captured now so a queued expense can be rendered offline,
    // without needing the categories or members list to still be cached.
    const category = categories.data?.find((c) => c.id === values.categoryId);
    const payer = members.data?.find((m) => m.id === values.paidBy);

    try {
      await submitExpense({
        totalPaise: values.amountPaise,
        categoryId: values.categoryId,
        categoryName: category?.name ?? 'Uncategorised',
        categoryIcon: category?.icon ?? null,
        description: values.description.trim() || null,
        expenseDate: values.date,
        paidBy: values.paidBy,
        paidByName: payer?.displayName ?? '—',
        splits: values.splits.map((s) => ({
          member_id: s.memberId,
          amount_paise: s.amountPaise,
        })),
      });

      // Sent or queued, the entry is safe either way — so the screen closes
      // and the banner reports what happened. The buzz is the confirmation
      // that survives the screen disappearing.
      committed();
      router.back();
    } catch (e) {
      // Only a genuine rejection lands here: a closed month, a bad split.
      // Those must be fixed now, not queued.
      rejected();
      setError(humanError(e));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.side}>
            <ThemedText themeColor="textSecondary" style={Type.body}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText style={Type.headline}>New expense</ThemedText>
          <View style={styles.side} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
         >
          {!online ? (
            <View style={[styles.offline, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="cloud-offline-outline" size={15} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                You&apos;re offline. Save it anyway — it sends itself when you reconnect.
              </ThemedText>
            </View>
          ) : null}

          <ExpenseForm
            submitLabel="Save"
            onSubmit={save}
            busy={busy}
            error={error}
            showSuggestions
            autoFocusAmount
            initial={{ paidBy: member?.id, amount: params.amount }}
          />
        </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  side: { width: 56 },
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four, paddingBottom: Spacing.six },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
