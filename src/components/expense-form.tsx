import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BillPhotoPicker } from '@/components/bill-photos';
import { ThemedText } from '@/components/themed-text';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { Notice } from '@/components/ui/notice';
import { Select, type SelectOption } from '@/components/ui/select';
import { appFontFor } from '@/constants/fonts';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedPhoto } from '@/lib/attachments';
import { addDays, formatRange, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useAwayPeriods, useCategories, useMembers, useSuggestions } from '@/lib/queries';
import { assertBalanced, defaultParticipants, isPresent, splitEqually, type Split } from '@/lib/split';

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

      {/* What, what for and when: one white card, an icon tile a row. */}
      <View style={[styles.card, card]}>
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
          <View style={[styles.detailIcon, { backgroundColor: theme.primarySoft }]}>
            <Ionicons name="create-outline" size={18} color={theme.brandInk} />
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What for (optional)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="What for"
            maxLength={120}
            editable={!busy}
            style={[Type.body, appFontFor(Type.body), styles.detailInput, { color: theme.text }]}
          />
        </View>

        {/* Today, Yesterday, or any other day from the calendar: people log
            a receipt days later all the time. */}
        <View style={[styles.detailRow, { borderTopColor: theme.border }]}>
          <View style={[styles.detailIcon, { backgroundColor: theme.primarySoft }]}>
            <Ionicons name="calendar-outline" size={18} color={theme.brandInk} />
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="When"
            style={[styles.segment, styles.flex, { backgroundColor: theme.liftTile }]}>
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
                  style={[styles.segmentItem, selected && [styles.segmentOn, card]]}>
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
              style={[styles.segmentItem, isOtherDay && [styles.segmentOn, card]]}>
              <ThemedText
                themeColor={isOtherDay ? 'text' : 'textSecondary'}
                style={[Type.caption, isOtherDay && styles.semi]}
                numberOfLines={1}>
                {isOtherDay ? formatRange(date, date) : 'Pick a day'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>

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
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`Paid by ${m.displayName}`}
                onPress={() => setPaidBy(m.id)}
                disabled={busy}
                style={({ pressed }) => [styles.payer, { opacity: pressed ? 0.7 : 1 }]}>
                <View>
                  <Avatar
                    name={m.displayName}
                    seed={m.id}
                    size={50}
                    ring={selected}
                    ringColor={theme.primary}
                    style={selected ? undefined : styles.dim}
                  />
                  {/* A tick as well as the ring, so the choice reads without
                      colour. */}
                  {selected ? (
                    <View style={[styles.payerTick, { backgroundColor: theme.primary, borderColor: theme.background }]}>
                      <Ionicons name="checkmark" size={11} color={theme.onPrimary} />
                    </View>
                  ) : null}
                </View>
                <ThemedText
                  style={[
                    Type.micro,
                    { color: selected ? theme.brandInk : theme.textTertiary },
                    selected && styles.semi,
                  ]}
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

                <Ionicons
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
            <Ionicons name="information-circle-outline" size={15} color={theme.info} />
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
    elevation: 2,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },

  // The white cards: rounded, a soft shadow, clipping their rows' tints.
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 3,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
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
  payerRow: { gap: Spacing.three, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  payer: { alignItems: 'center', gap: Spacing.two, width: 64 },
  payerTick: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // A pill switch: the chosen day is a small white pill inside it.
  segment: { flexDirection: 'row', borderRadius: 999, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  segmentOn: {
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 1,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
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
