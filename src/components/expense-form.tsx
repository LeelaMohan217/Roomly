import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, type SelectOption } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRange, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useAwayPeriods, useCategories, useMembers, useSuggestions } from '@/lib/queries';
import { assertBalanced, defaultParticipants, isPresent, splitEqually, type Split } from '@/lib/split';

export type ExpenseFormValues = {
  amountPaise: number;
  categoryId: string;
  description: string;
  paidBy: string;
  date: string;
  splits: Split[];
};

type Props = {
  initial?: {
    amount?: string;
    categoryId?: string;
    description?: string;
    paidBy?: string;
    date?: string;
    participants?: string[];
  };
  submitLabel: string;
  onSubmit: (values: ExpenseFormValues) => void;
  busy?: boolean;
  error?: string | null;
  showSuggestions?: boolean;
  autoFocusAmount?: boolean;
};

/**
 * Shared by Add and Edit. One implementation matters more than usual here: if
 * the two drifted, an edit could silently apply a different split rule from
 * the one that created the expense.
 */
export function ExpenseForm({
  initial,
  submitLabel,
  onSubmit,
  busy = false,
  error = null,
  showSuggestions = false,
  autoFocusAmount = false,
}: Props) {
  const theme = useTheme();

  const members = useMembers();
  const categories = useCategories();
  const away = useAwayPeriods();
  const suggestions = useSuggestions();

  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [paidBy, setPaidBy] = useState<string | null>(initial?.paidBy ?? null);
  const [date, setDate] = useState(initial?.date ?? todayIso());

  // The calendar sheet. pickerMonth is separate from `date` so paging back
  // through months does not change the selection until a day is actually
  // tapped.
  const [splitError, setSplitError] = useState<string | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => {
    const [y, m] = (initial?.date ?? todayIso()).split('-').map(Number);
    return { year: y, month: m };
  });
  const [manual, setManual] = useState<string[] | null>(initial?.participants ?? null);

  const category = categories.data?.find((c) => c.id === categoryId) ?? null;
  const amountPaise = parseAmount(amount);

  const categoryOptions: SelectOption[] = (categories.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    glyph: iconFor(c.icon),
    hint: c.respectsAwayCalendar
      ? 'Splits only between people who were here'
      : c.kind === 'bulk'
        ? 'Everyone pays — it outlasts any one trip'
        : 'Everyone pays, away or not',
  }));

  const auto = useMemo(() => {
    if (!members.data) return [];
    // Before a category is chosen there's no away rule to apply, so everyone
    // is in. Showing "0 of 2" with every name struck through reads as an
    // error rather than as "not decided yet".
    if (!category || !away.data) return members.data.map((m) => m.id);
    return defaultParticipants(members.data, category, date, away.data);
  }, [category, members.data, away.data, date]);

  /**
   * Changing category or date re-derives the split, since the right default
   * changed. But not on first render — an expense being edited must keep the
   * split it was saved with.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setManual(null);
  }, [categoryId, date]);

  const participants = manual ?? auto;

  const splits = useMemo(() => {
    if (!amountPaise || participants.length === 0) return [];
    return splitEqually(amountPaise, participants, paidBy ?? undefined);
  }, [amountPaise, participants, paidBy]);

  function toggleParticipant(id: string) {
    const next = new Set(manual ?? auto);
    if (next.has(id)) {
      if (next.size === 1) return; // never allow an empty split
      next.delete(id);
    } else {
      next.add(id);
    }
    setManual((members.data ?? []).map((m) => m.id).filter((mid) => next.has(mid)));
  }

  const canSubmit = !!amountPaise && !!categoryId && !!paidBy && participants.length > 0 && !busy;
  const today = todayIso();
  const yesterday = addDays(today, -1);
  const isOtherDay = date !== today && date !== yesterday;

  return (
    <>
      {/* Amount is the only field that always needs thought, so it gets the
          screen's one large number and opens focused. */}
      <Card style={styles.amountCard}>
        <ThemedText themeColor="textTertiary" style={Type.label}>
          AMOUNT
        </ThemedText>
        <View style={styles.amountRow}>
          <ThemedText themeColor="textTertiary" style={styles.currency}>
            ₹
          </ThemedText>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={theme.textTertiary}
            keyboardType="decimal-pad"
            // Rs 99,99,999.99 is more than any household expense, and without
            // a cap a mis-keyed run of digits parsed fine here and failed only
            // at the server.
            maxLength={12}
            autoFocus={autoFocusAmount}
            editable={!busy}
            style={[styles.amountInput, { color: theme.text }]}
          />
        </View>

        {showSuggestions && suggestions.data && suggestions.data.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}>
            {suggestions.data.map((s) => (
              <Pressable
                key={`${s.label}-${s.amountPaise}`}
                onPress={() => {
                  setAmount(String(s.amountPaise / 100));
                  setCategoryId(s.categoryId);
                  setDescription(s.label);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: theme.backgroundSelected,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText style={Type.micro}>
                  {s.label} {formatPaise(s.amountPaise)}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </Card>

      <Select
        label="Category"
        placeholder="Choose a category"
        value={categoryId}
        options={categoryOptions}
        onChange={setCategoryId}
        disabled={busy}
      />

      <TextField
        label="What for"
        value={description}
        onChangeText={setDescription}
        placeholder="Optional — milk, vegetables…"
        maxLength={120}
        editable={!busy}
      />

      <View style={styles.field}>
        <ThemedText themeColor="textTertiary" style={Type.label}>
          PAID BY
        </ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.payerRow}>
          {members.data?.map((m) => {
            const selected = m.id === paidBy;
            return (
              <Pressable
                key={m.id}
                onPress={() => setPaidBy(m.id)}
                disabled={busy}
                style={({ pressed }) => [styles.payer, { opacity: pressed ? 0.7 : 1 }]}>
                <Avatar
                  name={m.displayName}
                  seed={m.id}
                  size={44}
                  ring={selected}
                  ringColor={theme.primary}
                  style={selected ? undefined : styles.dim}
                />
                <ThemedText
                  themeColor={selected ? 'text' : 'textTertiary'}
                  style={[Type.micro, selected && styles.semi]}
                  numberOfLines={1}>
                  {m.displayName}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Today, Yesterday, and — the part that was missing — any other day.
          The third segment used to be a plain View rather than a Pressable, and
          only appeared at all when editing a record that already had another
          date. So there was NO date picker: on a shared-expense app, where
          people routinely log a receipt days later, nothing dated before
          yesterday could ever be entered. */}
      <View style={styles.field}>
        <ThemedText themeColor="textTertiary" style={Type.label}>
          WHEN
        </ThemedText>
        <View style={[styles.segment, { backgroundColor: theme.backgroundSunken }]}>
          {[
            { key: today, label: 'Today' },
            { key: yesterday, label: 'Yesterday' },
          ].map((opt) => {
            const selected = date === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setDate(opt.key)}
                disabled={busy}
                style={[
                  styles.segmentItem,
                  selected && { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText
                  themeColor={selected ? 'text' : 'textSecondary'}
                  style={[Type.caption, selected && styles.semi]}>
                  {opt.label}
                </ThemedText>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => {
              const [y, m] = date.split('-').map(Number);
              setPickerMonth({ year: y, month: m });
              setPickingDate(true);
            }}
            disabled={busy}
            style={[
              styles.segmentItem,
              isOtherDay && { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText
              themeColor={isOtherDay ? 'text' : 'textSecondary'}
              style={[Type.caption, isOtherDay && styles.semi]}>
              {isOtherDay ? formatRange(date, date) : 'Pick a day'}
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <Sheet
        visible={pickingDate}
        title="When was this?"
        subtitle="Backdating is fine — the split is worked out for the day you choose."
        onClose={() => setPickingDate(false)}>
        <MonthCalendar
          year={pickerMonth.year}
          month={pickerMonth.month}
          onMonthChange={(year, month) => setPickerMonth({ year, month })}
          start={date}
          end={date}
          onDayPress={(iso) => {
            setDate(iso);
            setPickingDate(false);
          }}
        />
      </Sheet>

      <View style={styles.field}>
        <View style={styles.splitHead}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            SPLIT BETWEEN
          </ThemedText>
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            {participants.length} of {members.data?.length ?? 0}
          </ThemedText>
        </View>

        <Card padded={false}>
          {members.data?.map((m, i) => {
            const included = participants.includes(m.id);
            const isAway = away.data ? !isPresent(m.id, date, away.data) : false;
            const share = splits.find((s) => s.memberId === m.id);

            return (
              <Pressable
                key={m.id}
                onPress={() => toggleParticipant(m.id)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.splitRow,
                  i < (members.data?.length ?? 0) - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                  },
                  { opacity: pressed ? 0.6 : 1 },
                ]}>
                <Avatar
                  name={m.displayName}
                  seed={m.id}
                  size={36}
                  style={included ? undefined : styles.dim}
                />

                <View style={styles.flex}>
                  <ThemedText
                    themeColor={included ? 'text' : 'textTertiary'}
                    style={[Type.body, !included && styles.struck]}
                    numberOfLines={1}>
                    {m.displayName}
                  </ThemedText>
                  {!included ? (
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {isAway ? 'away — not charged' : 'not included'}
                    </ThemedText>
                  ) : null}
                </View>

                {included && share ? (
                  <ThemedText style={Type.amount}>{formatPaise(share.amountPaise)}</ThemedText>
                ) : null}

                <Ionicons
                  name={included ? 'checkmark-circle' : 'ellipse-outline'}
                  size={21}
                  color={included ? theme.primary : theme.borderStrong}
                />
              </Pressable>
            );
          })}
        </Card>

        {category && !category.respectsAwayCalendar ? (
          <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
            <Ionicons name="information-circle-outline" size={14} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
              Fixed cost — everyone pays, away or not.
            </ThemedText>
          </View>
        ) : null}
      </View>

      {error ?? splitError ? (
        <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
          <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
            {error ?? splitError}
          </ThemedText>
        </View>
      ) : null}

      <Button
        title={amountPaise ? `${submitLabel} ${formatPaise(amountPaise)}` : submitLabel}
        onPress={() => {
          // assertBalanced has existed and been tested since split.ts:85, and
          // was called by nothing. The database catches an unbalanced split at
          // commit (0007_create_expense.sql:25-29), but only after a round
          // trip and with a message about a trigger. Checking here fails
          // instantly, on the device, before any money is sent.
          try {
            assertBalanced(amountPaise!, splits);
          } catch (err) {
            setSplitError(humanError(err));
            return;
          }
          setSplitError(null);
          onSubmit({
            amountPaise: amountPaise!,
            categoryId: categoryId!,
            description,
            paidBy: paidBy!,
            date,
            splits,
          });
        }}
        loading={busy}
        disabled={!canSubmit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  semi: { fontWeight: '700' },
  dim: { opacity: 0.4 },
  struck: { textDecorationLine: 'line-through' },

  amountCard: { gap: Spacing.two },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  currency: { fontSize: 26, fontWeight: '600' },
  // minWidth 0 is load-bearing on web: an <input> has an intrinsic width and
  // CSS min-width defaults to auto, so `flex: 1` alone won't let it shrink and
  // it pushes the whole screen sideways. React Native defaults min-width to 0,
  // which is why this only shows up in the browser.
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -1,
    padding: 0,
  },
  chipRow: { gap: Spacing.two, paddingTop: Spacing.two },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },

  field: { gap: Spacing.two },
  payerRow: { gap: Spacing.four, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  payer: { alignItems: 'center', gap: Spacing.two, width: 60 },

  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
  },

  splitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
});
