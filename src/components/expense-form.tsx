import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BillPhotoPicker } from '@/components/bill-photos';
import { ThemedText } from '@/components/themed-text';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { TextField } from '@/components/ui/text-field';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { Notice } from '@/components/ui/notice';
import { Select, type SelectOption } from '@/components/ui/select';
import { appFontFor } from '@/constants/fonts';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedPhoto } from '@/lib/attachments';
import { addDays, formatRange, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { categoryIcon } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useAwayPeriods, useCategories, useMembers, useSuggestions } from '@/lib/queries';
import { assertBalanced, defaultParticipants, isPresent, splitEqually, type Split } from '@/lib/split';
import { Icon } from '@/components/ui/icon';

// The amount input's width per typed character at fontSize 48, plus room for
// the caret -- see amountInput below.
const AMOUNT_DIGIT = 29;
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
    icon: categoryIcon(c.icon),
    hint: c.respectsAwayCalendar
      ? 'Splits only between people who were here'
      : c.kind === 'bulk'
        ? 'Everyone pays — it outlasts any one trip'
        : 'Everyone pays, away or not',
  }));

  const payerOptions: SelectOption[] = (members.data ?? []).map((m) => ({
    value: m.id,
    label: m.displayName,
    icon: 'person-outline',
  }));

  function chooseDay(iso: string) {
    setDate(iso);
    setPickingDate(false);
  }

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

  const card = { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow };

  // One chip per category and amount. The same thing typed two ways
  // ("Kothimera" and "Kotthimera", both ₹10 Vegetables) made two chips that
  // fill in the same expense. The first is kept: the list comes best first.
  // Two different things at one price stay apart if their categories differ.
  const chips = (suggestions.data ?? []).filter(
    (s, i, all) =>
      all.findIndex((o) => o.categoryId === s.categoryId && o.amountPaise === s.amountPaise) === i
  );

  return (
    <>
      {/* Amount is the only field that always needs thought, so it gets the
          screen's one large number and opens focused -- on the page, centred,
          without a box: a small "How much?" over it, and the ₹ says the rest. */}
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
              appFontFor({ fontWeight: '600' }),
              { color: theme.text, width: AMOUNT_DIGIT * Math.max(amount.length, 1) + AMOUNT_PAD },
            ]}
          />
        </View>

        {showSuggestions && chips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipBleed}
            contentContainerStyle={styles.chipRow}>
            {chips.map((s) => (
              <Pressable
                key={`${s.label}-${s.amountPaise}`}
                accessibilityRole="button"
                accessibilityLabel={`Use ${s.label}, ${formatPaise(s.amountPaise)}`}
                onPress={() => {
                  setAmount(String(s.amountPaise / 100));
                  setCategoryId(s.categoryId);
                  setDescription(s.label);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  card,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <ThemedText style={[Type.caption, styles.semi]} numberOfLines={1}>
                  {s.label}
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={Type.caption}>
                  {formatPaise(s.amountPaise)}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/* The same fields, in the same order and style, as My ledger's form:
          a dropdown that opens under its box, then what for, who paid, when. */}
      <Select
        label="Category"
        placeholder="Choose a category"
        value={categoryId}
        options={categoryOptions}
        onChange={setCategoryId}
        disabled={busy}
        anchored
      />

      <TextField
        label="What for (optional)"
        value={description}
        onChangeText={(v) => setDescription(v.slice(0, 120))}
        placeholder="Milk, rent, Wi-Fi bill"
        editable={!busy}
        returnKeyType="done"
      />

      <Select
        label="Paid by"
        placeholder="Who paid?"
        value={paidBy}
        options={payerOptions}
        onChange={setPaidBy}
        disabled={busy}
        anchored
      />

      {/* Today, Yesterday, or any other day from the calendar: people log a
          receipt days later all the time. */}
      <View style={styles.block}>
        <ThemedText themeColor="textSecondary" style={styles.fieldLabel}>
          When
        </ThemedText>
        <View style={styles.days}>
          {(
            [
              { key: 'today', label: 'Today', on: date === today, onPress: () => chooseDay(today) },
              {
                key: 'yesterday',
                label: 'Yesterday',
                on: date === yesterday,
                onPress: () => chooseDay(yesterday),
              },
              {
                key: 'other',
                label: isOtherDay ? formatRange(date, date) : 'Pick a day',
                on: isOtherDay,
                onPress: () => {
                  const [y, m] = date.split('-').map(Number);
                  setPickerMonth({ year: y, month: m });
                  setPickingDate((p) => !p);
                },
              },
            ] as const
          ).map((d) => (
            <Pressable
              key={d.key}
              accessibilityRole="button"
              accessibilityState={{ selected: d.on }}
              onPress={d.onPress}
              disabled={busy}
              style={[
                styles.day,
                {
                  backgroundColor: d.on ? theme.tabActive : theme.backgroundElement,
                  borderColor: d.on ? theme.primary : theme.liftEdge,
                },
              ]}>
              {d.key === 'other' ? (
                <Icon
                  name="calendar-clear-outline"
                  size={14}
                  color={d.on ? theme.tabActiveInk : theme.textSecondary}
                />
              ) : null}
              <ThemedText style={[Type.caption, { color: d.on ? theme.tabActiveInk : theme.text }]}>
                {d.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {pickingDate ? (
          <MonthCalendar
            year={pickerMonth.year}
            month={pickerMonth.month}
            onMonthChange={(year, month) => setPickerMonth({ year, month })}
            start={date}
            end={date}
            onDayPress={(iso) => {
              if (iso <= today) chooseDay(iso);
            }}
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <View style={styles.splitHead}>
          <ThemedText style={[styles.sectionTitle, styles.flex]}>Split between</ThemedText>
          <View style={[styles.countPill, { backgroundColor: theme.primarySoft }]}>
            <ThemedText style={[Type.micro, styles.semi, { color: theme.brandInk }]}>
              {participants.length} of {members.data?.length ?? 0}
            </ThemedText>
          </View>
        </View>

        <View style={[styles.card, card]}>
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
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <Avatar
                  name={m.displayName}
                  seed={m.id}
                  size={40}
                  style={included ? undefined : styles.dim}
                />

                <View style={styles.flex}>
                  <ThemedText
                    themeColor={included ? 'text' : 'textTertiary'}
                    style={[Type.body, styles.semi, !included && styles.struck]}
                    numberOfLines={1}>
                    {m.displayName}
                  </ThemedText>
                  {!included ? (
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {isAway ? 'away — not charged' : 'not included'}
                    </ThemedText>
                  ) : null}
                </View>

                {included && share ? <Money paise={share.amountPaise} size="row" /> : null}

                <Icon
                  name={included ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={included ? theme.primary : theme.borderStrong}
                />
              </Pressable>
            );
          })}
        </View>

        {category && !category.respectsAwayCalendar ? (
          <View style={[styles.note, { backgroundColor: theme.infoSoft }]}>
            <Icon name="information-circle-outline" size={15} color={theme.info} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.info }]}>
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
        style={styles.submit}
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

  amountBlock: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  currency: { fontSize: 32, lineHeight: 40, fontWeight: '600' },
  // An explicit width (set inline from the digit count), not flex: on web an
  // <input> has an intrinsic width and CSS min-width defaults to auto, so a
  // flexed input pushed the whole screen sideways. minWidth 0 keeps that true.
  amountInput: {
    minWidth: 0,
    maxWidth: 300,
    fontSize: 48,
    letterSpacing: -1.4,
    padding: 0,
  },
  // Out to the screen edges, so the row scrolls under them; centred while
  // the chips fit.
  chipBleed: { alignSelf: 'stretch', marginHorizontal: -Spacing.four, marginTop: Spacing.one },
  chipRow: {
    gap: Spacing.two,
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

  // The cards: soft white, rounded, a hairline edge, clipping their rows' tints.
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // minWidth 0 for the same web reason as the amount input.
  detailInput: { flex: 1, minWidth: 0, paddingVertical: Spacing.one },
  // Section titles as on the tabs: large, medium weight.
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },

  field: { gap: Spacing.two + 2 },

  // When: as on My ledger's form -- the label, then a pill per day.
  block: { gap: Spacing.two },
  fieldLabel: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
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

  splitHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  countPill: { paddingHorizontal: Spacing.two + 2, paddingVertical: 3, borderRadius: 999 },
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
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },

  // The one action: a full-width pill, taller than the default button.
  submit: { minHeight: 56, borderRadius: 999, marginTop: Spacing.one },
});
