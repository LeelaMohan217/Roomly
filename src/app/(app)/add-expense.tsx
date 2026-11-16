import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpenseForm, type ExpenseFormValues } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { useDialog } from '@/components/ui/dialog';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MAX_PHOTOS, uploadBillPhotos } from '@/lib/attachments';
import { humanError } from '@/lib/errors';
import { committed, rejected } from '@/lib/haptics';
import { useCategories, useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync';

export default function AddExpenseScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const { member } = useSession();
  const { submitExpense, online } = useSync();

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

    let expenseId: string | null;
    try {
      expenseId = await submitExpense({
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
    } catch (e) {
      // Only a genuine rejection lands here: a closed month, a bad split.
      // Those must be fixed now, not queued.
      rejected();
      setError(humanError(e));
      setBusy(false);
      return;
    }

    // Sent or queued, the entry is safe either way — so the screen closes
    // and the banner reports what happened. The buzz is the confirmation
    // that survives the screen disappearing.
    committed();

    // Photos follow the expense, which needs to exist first. A queued expense
    // has no server row yet, so its photos cannot go with it: say so rather
    // than drop them quietly.
    if (values.photos.length > 0 && member) {
      if (expenseId) {
        const { failed, reason } = await uploadBillPhotos(
          member.household_id,
          member.id,
          expenseId,
          values.photos
        );
        if (failed > 0) {
          void dialog.alert({
            tone: 'warning',
            icon: 'image-outline',
            title: 'Saved, but not every photo',
            message: `${failed === 1 ? 'One photo' : `${failed} photos`} did not upload${reason ? ` (${reason})` : ''}. Open the expense to add ${failed === 1 ? 'it' : 'them'} again.`,
          });
        }
      } else {
        void dialog.alert({
          tone: 'warning',
          icon: 'cloud-offline-outline',
          title: 'Saved without the photos',
          message:
            'You’re offline, so the expense is queued and the photos can’t go with it. Once it appears, open it and add them from there.',
        });
      }
    }

    router.back();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        {/* An ✕ rather than the word Cancel: the same round button as the
            back button on every other screen. */}
        <View style={styles.topBar}>
          <View style={styles.side}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => router.back()}
              hitSlop={10}
              style={({ pressed }) => [
                styles.close,
                { backgroundColor: theme.lift, borderColor: theme.liftEdge, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="close" size={20} color={theme.text} />
            </Pressable>
          </View>
          <ThemedText style={styles.title}>New expense</ThemedText>
          <View style={styles.side} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
         >
          {/* One grey line. */}
          {!online ? (
            <View style={styles.offline}>
              <Ionicons name="cloud-offline-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.caption, styles.flex]}>
                Offline · it sends itself when you reconnect
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
            photoRoom={MAX_PHOTOS}
            initial={{ paidBy: member?.id }}
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
  title: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four, paddingBottom: Spacing.six },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
