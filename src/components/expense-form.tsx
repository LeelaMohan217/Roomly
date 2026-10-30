import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BillPhotoPicker } from '@/components/bill-photos';
import { ThemedText } from '@/components/themed-text';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Select, type SelectOption } from '@/components/ui/select';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedPhoto } from '@/lib/attachments';
import { addDays, formatRange, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useAwayPeriods, useCategories, useMembers, useSuggestions } from '@/lib/queries';
import { assertBalanced, defaultParticipants, isPresent, splitEqually, type Split } from '@/lib/split';

// The amount input's width per typed character at fontSize 40, plus room for
// the caret -- see amountInput below.
const AMOUNT_DIGIT = 24;
const AMOUNT_PAD = 10;

export type ExpenseFormValues = {
  amountPaise: number;
  categoryId: string;
  description: string;
  paidBy: string;
  date: string;
  splits: Split[];
  /** Chosen on the form, uploaded by the caller once the expense is saved. */
  photos: PickedPhoto[];
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
  /** How many bill photos may still be attached. Omitted: no photo picker. */
  photoRoom?: number;
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
  photoRoom,
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
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

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
          screen's one large number and opens focused -- on the page, centred,
          without a box or a label: the ₹ says what it is. */}
      <View style={styles.amountBlock}>
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
            accessibilityLabel="Amount"
            // Rs 99,99,999.99 is more than any household expense, and without
            // a cap a mis-keyed run of digits parsed fine here and failed only
            // at the server.
            maxLength={12}
            autoFocus={autoFocusAmount}
            editable={!busy}
            // Sized to what is typed, so the ₹ and the digits stay centred
            // together; a flexed input would leave the ₹ stranded at the left.
            style={[
              styles.amountInput,
              { color: theme.text, width: AMOUNT_DIGIT * Math.max(amount.length, 1) + AMOUNT_PAD },
            ]}
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
      </View>

      {/* What, what for and when: one grouped list with an icon a row, in
          place of three labelled fields. */}
      <Card padded={false}>
        <Select
          bare
          icon="apps-outline"
          label="Category"
          placeholder="Category"
          value={categoryId}
          options={categoryOptions}
          onChange={setCategoryId}
          disabled={busy}
        />

        <View style={[styles.detailRow, { borderTopColor: theme.border }]}>
          <View style={[styles.detailIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="create-outline" size={16} color={theme.textSecondary} />
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What for (optional)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="What for"
            maxLength={120}
            editable={!busy}
            style={[Type.body, styles.detailInput, { color: theme.text }]}
          />
        </View>

        {/* Today, Yesterday, and — the part that was missing — any other day.
            The third segment used to be a plain View rather than a Pressable,
            and only appeared at all when editing a record that already had
            another date. So there was NO date picker: on a shared-expense app,
            where people routinely log a receipt days later, nothing dated
            before yesterday could ever be entered. */}
        <View style={[styles.detailRow, { borderTopColor: theme.border }]}>
          <View style={[styles.detailIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="When"
            style={[styles.segment, styles.flex, { backgroundColor: theme.backgroundSunken }]}>
            {[
              { key: today, label: 'Today' },
              { key: yesterday, label: 'Yesterday' },
            ].map((opt) => {
              const selected = date === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
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
              accessibilityRole="radio"
              accessibilityState={{ checked: isOtherDay }}
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
                style={[Type.caption, isOtherDay && styles.semi]}
                numberOfLines={1}>
                {isOtherDay ? formatRange(date, date) : 'Pick a day'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Card>

      <View style={styles.field}>
        <ThemedText style={styles.sectionTitle}>Paid by</ThemedText>
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
          <ThemedText style={styles.sectionTitle}>Split between</ThemedText>
          <ThemedText themeColor="textTertiary" style={Type.caption}>
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
                accessibilityRole="checkbox"
                accessibilityState={{ checked: included }}
                style={({ pressed }) => [
                  styles.splitRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
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

      {photoRoom !== undefined ? (
        <BillPhotoPicker photos={photos} onChange={setPhotos} max={photoRoom} disabled={busy} />
      ) : null}

      {error ?? splitError ? <Notice tone="danger" message={(error ?? splitError)!} /> : null}

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
            photos,
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
  semi: { fontWeight: '600' },
  dim: { opacity: 0.4 },
  struck: { textDecorationLine: 'line-through' },

  amountBlock: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  currency: { fontSize: 28, fontWeight: '600' },
  // An explicit width (set inline from the digit count), not flex: on web an
  // <input> has an intrinsic width and CSS min-width defaults to auto, so a
  // flexed input pushed the whole screen sideways. minWidth 0 keeps that true.
  amountInput: {
    minWidth: 0,
    maxWidth: 280,
    fontSize: 40,
    fontWeight: '600',
    letterSpacing: -1,
    padding: 0,
  },
  // Centred while they fit; scrollable once they don't.
  chipRow: { gap: Spacing.two, flexGrow: 1, justifyContent: 'center' },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailIcon: { width: 34, height: 34, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  // minWidth 0 for the same web reason as the amount input.
  detailInput: { flex: 1, minWidth: 0, paddingVertical: Spacing.one },
  // Sentence case at heading size, as on the redesigned screens.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
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
