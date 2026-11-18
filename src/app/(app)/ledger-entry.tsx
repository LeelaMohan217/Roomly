import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpenseReview } from '@/components/expense-review';
import { SaveSuccess } from '@/components/save-success';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useDialog } from '@/components/ui/dialog';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { LoadFailed, Loading } from '@/components/ui/query-state';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { appFontFor } from '@/constants/fonts';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dayLabel, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { formatPaise, paiseToRupees, parseAmount } from '@/lib/money';
import { newClientId } from '@/lib/outbox';
import {
  PERSONAL_CATEGORIES,
  personalCategory,
  usePersonalExpense,
  usePersonalMutations,
  type PersonalExpense,
} from '@/lib/personal';
import { Icon } from '@/components/ui/icon';

// The amount input's width per typed character at fontSize 48, plus room for
// the caret -- the same sizing as New expense's amount.
const AMOUNT_DIGIT = 29;
const AMOUNT_PAD = 10;

/**
 * Add or change one private expense, as a page of its own: how much, what for,
 * a category and a day. No payer, no split, no approval -- it is yours and
 * nobody else's. `?id=` opens an existing one for editing.
 */
export default function LedgerEntryScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = usePersonalExpense(id);

  if (id && !existing.data) {
    return (
      <Frame title="Edit private expense">
        {existing.isError ? (
          <LoadFailed
            what="this expense"
            error={existing.error}
            onRetry={() => void existing.refetch()}
          />
        ) : existing.isLoading ? (
          <Loading />
        ) : (
          <ThemedText themeColor="textSecondary" style={[Type.body, styles.center]}>
            This expense has been deleted.
          </ThemedText>
        )}
      </Frame>
    );
  }

  // Keyed so the form's fields start from the expense once it has loaded.
  return <EntryForm key={existing.data?.id ?? 'new'} editing={existing.data ?? null} />;
}

function EntryForm({ editing }: { editing: PersonalExpense | null }) {
  const theme = useTheme();
  const router = useRouter();
  const dialog = useDialog();
  const { add, update, remove } = usePersonalMutations();

  const today = todayIso();
  const yesterday = addDays(today, -1);
  const [amount, setAmount] = useState(editing ? String(paiseToRupees(editing.amountPaise)) : '');
  const [description, setDescription] = useState(editing?.description ?? '');
  // Required, so a new expense starts with none picked rather than a guess.
  const [category, setCategory] = useState<string | null>(editing?.category ?? null);
  const [spentOn, setSpentOn] = useState(editing?.spentOn ?? today);
  const [pickingDay, setPickingDay] = useState(false);
  const [calendar, setCalendar] = useState(() => {
    const [y, m] = (editing?.spentOn ?? today).split('-').map(Number);
    return { year: y, month: m };
  });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key for this page's life: a retried save is the same row.
  const [clientId] = useState(newClientId);

  const amountPaise = parseAmount(amount);
  const busy = add.isPending || update.isPending || remove.isPending;
  const dayChoice = spentOn === today ? 'today' : spentOn === yesterday ? 'yesterday' : 'other';

  function chooseDay(iso: string) {
    setSpentOn(iso);
    setPickingDay(false);
    setError(null);
  }

  // The bill shown before saving, and the success screen after adding.
  const [reviewing, setReviewing] = useState(false);
  const [added, setAdded] = useState(false);

  /** Checks the form, then shows the bill: nothing is saved yet. */
  function save() {
    setTouched(true);
    // Amount and category are required. The day always has one (it starts on
    // today), and What for is optional.
    if (!amountPaise || !category || busy) return;
    if (spentOn > today) {
      setError('That day hasn’t happened yet.');
      return;
    }
    setError(null);
    setReviewing(true);
  }

  /** Good to go, from the bill. */
  async function commit() {
    if (!amountPaise || !category) return;
    // Left blank, an expense is named after its category ("Food"), so the
    // history list always has something to show.
    const name = description.trim() || personalCategory(category).label;
    const draft = { amountPaise, description: name, category, spentOn, note: null };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, draft });
        setReviewing(false);
        dialog.toast({ message: 'Changes saved' });
        router.back();
      } else {
        await add.mutateAsync({ draft, clientId });
        setReviewing(false);
        setAdded(true);
      }
    } catch (e) {
      setReviewing(false);
      setError(humanError(e));
    }
  }

  if (added && amountPaise && category) {
    const cat = personalCategory(category);
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <SaveSuccess
          title="Added to your ledger"
          lines={[
            `${formatPaise(amountPaise)} for ${description.trim() || cat.label}.`,
            'Only you can see it.',
          ]}
          onDone={() => router.back()}
          // A fresh page: a new private expense from the start.
          onAnother={() => router.replace('/ledger-entry')}
        />
      </SafeAreaView>
    );
  }

  async function deleteIt() {
    if (!editing || busy) return;
    const ok = await dialog.confirm({
      title: 'Delete this expense?',
      message: `${editing.description} will be removed from your ledger.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      icon: 'trash-outline',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(editing.id);
      dialog.toast({ message: 'Deleted from your ledger', icon: 'trash-outline' });
      router.back();
    } catch (e) {
      setError(humanError(e));
    }
  }

  return (
    <Frame
      title={editing ? 'Edit private expense' : 'New private expense'}
      footer={
        <View style={styles.footerButtons}>
          <Button
            title={amountPaise ? `Save ${formatPaise(amountPaise)}` : 'Save'}
            onPress={save}
            loading={add.isPending || update.isPending}
            disabled={busy}
          />
          {editing ? (
            <Button
              title="Delete"
              variant="danger"
              onPress={deleteIt}
              loading={remove.isPending}
              disabled={busy}
            />
          ) : null}
        </View>
      }>
      {/* The amount, large and centred, as on New expense. */}
      <View style={styles.amountBlock}>
        <ThemedText themeColor="textSecondary" style={Type.caption}>
          How much?
        </ThemedText>
        <View style={styles.amountRow}>
          <ThemedText themeColor="textTertiary" style={styles.currency}>
            ₹
          </ThemedText>
          <TextInput
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              setError(null);
            }}
            placeholder="0"
            placeholderTextColor={theme.textTertiary}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount"
            maxLength={12}
            autoFocus={!editing}
            editable={!busy}
            style={[
              styles.amountInput,
              appFontFor({ fontWeight: '600' }),
              { color: theme.text, width: AMOUNT_DIGIT * Math.max(amount.length, 1) + AMOUNT_PAD },
            ]}
          />
        </View>
        {touched && !amountPaise ? (
          <ThemedText style={[Type.caption, { color: theme.danger }]}>Enter an amount.</ThemedText>
        ) : null}
      </View>

      {/* The same dropdown as New expense's category. */}
      <Select
        label="Category"
        placeholder="Choose a category"
        value={category}
        options={PERSONAL_CATEGORIES.map((c) => ({
          value: c.slug,
          label: c.label,
          icon: c.icon,
        }))}
        onChange={(v) => {
          setCategory(v);
          setError(null);
        }}
        disabled={busy}
        anchored
      />
      {touched && !category ? (
        <ThemedText style={[Type.caption, styles.fieldError, { color: theme.danger }]}>
          Choose a category.
        </ThemedText>
      ) : null}

      <TextField
        label="What for (optional)"
        value={description}
        onChangeText={(v) => {
          setDescription(v.slice(0, 120));
          setError(null);
        }}
        placeholder="Gym membership"
        editable={!busy}
        returnKeyType="done"
      />

      <View style={styles.block}>
        <ThemedText themeColor="textSecondary" style={Type.caption}>
          When
        </ThemedText>
        <View style={styles.days}>
          {(
            [
              { key: 'today', label: 'Today', onPress: () => chooseDay(today) },
              { key: 'yesterday', label: 'Yesterday', onPress: () => chooseDay(yesterday) },
              {
                key: 'other',
                label: dayChoice === 'other' ? dayLabel(spentOn) : 'Pick a day',
                onPress: () => setPickingDay((p) => !p),
              },
            ] as const
          ).map((d) => {
            const on = d.key === dayChoice;
            return (
              <Pressable
                key={d.key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={d.onPress}
                disabled={busy}
                style={[
                  styles.day,
                  {
                    backgroundColor: on ? theme.tabActive : theme.backgroundElement,
                    borderColor: on ? theme.primary : theme.liftEdge,
                  },
                ]}>
                {d.key === 'other' ? (
                  <Icon
                    name="calendar-clear-outline"
                    size={14}
                    color={on ? theme.tabActiveInk : theme.textSecondary}
                  />
                ) : null}
                <ThemedText style={[Type.caption, { color: on ? theme.tabActiveInk : theme.text }]}>
                  {d.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {pickingDay ? (
          <MonthCalendar
            year={calendar.year}
            month={calendar.month}
            onMonthChange={(year, month) => setCalendar({ year, month })}
            start={spentOn}
            end={spentOn}
            onDayPress={(iso) => {
              if (iso <= today) chooseDay(iso);
            }}
          />
        ) : null}
      </View>

      {error ? (
        <ThemedText style={[Type.caption, { color: theme.danger }]} accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}

      {/* The last look, as a bill: the same as New expense's, without the
          payer and the split. */}
      {reviewing && amountPaise && category ? (
        <ExpenseReview
          visible
          heading={editing ? 'Check your changes' : 'Check before adding'}
          amountPaise={amountPaise}
          description={description.trim() || personalCategory(category).label}
          categoryName={personalCategory(category).label}
          icon={personalCategory(category).icon}
          iconColor={personalCategory(category).color}
          date={spentOn}
          note="Private: only you can see this"
          busy={add.isPending || update.isPending}
          onEdit={() => setReviewing(false)}
          onConfirm={() => void commit()}
        />
      ) : null}
    </Frame>
  );
}

/** The page around the form: a close button, a title, and the save button pinned below. */
function Frame({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.topBar}>
        <View style={styles.side}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: theme.lift,
                borderColor: theme.liftEdge,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Icon name="close" size={20} color={theme.text} />
          </Pressable>
        </View>
        <ThemedText style={styles.title}>{title}</ThemedText>
        <View style={styles.side} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        {children}
      </KeyboardAwareScrollView>

      {footer ? (
        <View style={[styles.footer, { backgroundColor: theme.background }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { textAlign: 'center' },
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
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four, paddingBottom: Spacing.five },

  amountBlock: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  currency: { fontSize: 32, lineHeight: 40, fontWeight: '600' },
  // An explicit width (set inline from the digit count), not flex: on web an
  // <input> has an intrinsic width, and a flexed one pushed the page sideways.
  amountInput: { minWidth: 0, maxWidth: 300, fontSize: 48, letterSpacing: -1.4, padding: 0 },

  block: { gap: Spacing.two },
  // Pulled up under the dropdown, as a TextField's own error sits.
  fieldError: { marginTop: -Spacing.three + 4 },

  days: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },

  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  footerButtons: { gap: Spacing.two },
});
