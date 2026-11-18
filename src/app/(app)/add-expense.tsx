import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpenseForm, type ExpenseFormValues } from '@/components/expense-form';
import { ExpenseReview } from '@/components/expense-review';
import { SaveSuccess } from '@/components/save-success';
import { formatPaise } from '@/lib/money';
import { ThemedText } from '@/components/themed-text';
import { useDialog } from '@/components/ui/dialog';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MAX_PHOTOS, uploadBillPhotos } from '@/lib/attachments';
import { humanError } from '@/lib/errors';
import { rejected } from '@/lib/haptics';
import { useCategories, useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync';
import { Icon } from '@/components/ui/icon';

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
  // Set once saved: the page shows the success screen instead of the form.
  const [done, setDone] = useState<{ title: string; lines: string[] } | null>(null);
  const [formKey, setFormKey] = useState(0);
  // What the form submitted, shown as a bill to confirm before it is saved.
  const [review, setReview] = useState<ExpenseFormValues | null>(null);
  const reviewCategory = review ? categories.data?.find((c) => c.id === review.categoryId) : undefined;
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.displayName ?? '—';

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

    // Sent or queued, the entry is safe either way: the page turns into the
    // success screen (with its buzz), which says which it was, what was
    // added and your part of it.
    const mine = values.splits.find((s) => s.memberId === member?.id)?.amountPaise ?? 0;
    const what = values.description.trim() || category?.name || 'Expense';
    const ways = values.splits.length;
    setDone({
      title: expenseId ? 'Expense added' : 'Saved offline',
      lines: [
        `${formatPaise(values.amountPaise)} for ${what}, ${ways === 1 ? 'not split' : `split ${ways} ways`}.`,
        expenseId
          ? mine > 0
            ? `Your share is ${formatPaise(mine)}.`
            : 'You’re not in this split.'
          : 'It sends itself when you’re back online.',
      ],
    });
    setBusy(false);

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
  }

  if (done) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <SaveSuccess
          title={done.title}
          lines={done.lines}
          onDone={() => router.back()}
          onAnother={() => {
            // A fresh, empty form: a new key remounts it.
            setDone(null);
            setError(null);
            setFormKey((k) => k + 1);
          }}
        />
      </SafeAreaView>
    );
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
              <Icon name="close" size={20} color={theme.text} />
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
              <Icon name="cloud-offline-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.caption, styles.flex]}>
                Offline · it sends itself when you reconnect
              </ThemedText>
            </View>
          ) : null}

          <ExpenseForm
            key={formKey}
            submitLabel="Save"
            onSubmit={(values) => {
              setError(null);
              setReview(values);
            }}
            busy={busy}
            error={error}
            showSuggestions
            autoFocusAmount
            photoRoom={MAX_PHOTOS}
            initial={{ paidBy: member?.id }}
          />
        </KeyboardAwareScrollView>

        {review ? (
          <ExpenseReview
            visible
            amountPaise={review.amountPaise}
            description={review.description}
            categoryName={reviewCategory?.name ?? 'Uncategorised'}
            categorySlug={reviewCategory?.icon ?? null}
            payerName={review.paidBy === member?.id ? `${nameOf(review.paidBy)} (you)` : nameOf(review.paidBy)}
            date={review.date}
            shares={review.splits.map((s) => ({
              id: s.memberId,
              name: nameOf(s.memberId),
              amountPaise: s.amountPaise,
              isMe: s.memberId === member?.id,
            }))}
            busy={busy}
            onEdit={() => setReview(null)}
            onConfirm={() => {
              const values = review;
              void save(values).then(() => setReview(null));
            }}
          />
        ) : null}
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
  },
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four, paddingBottom: Spacing.six },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
