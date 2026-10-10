import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useCategories, useMembers, useRecurring } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function RecurringEditScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';
  const { id } = useLocalSearchParams<{ id?: string }>();

  const categories = useCategories();
  const members = useMembers();
  const recurring = useRecurring();

  const existing = id ? recurring.data?.find((r) => r.id === id) : undefined;

  // Derived, not hydrated by an effect. Calling setState synchronously inside
  // an effect is what the React Compiler flagged: the data arrives, the effect
  // fires, state changes, everything re-renders. Instead each field holds only
  // what the user has actually EDITED -- null until then -- and falls back to
  // the loaded record. No effect, no `hydrated` latch, and no window where the
  // form shows blanks after the record has arrived.
  //
  // undefined means untouched here rather than null, because null is a
  // legitimate edited value for the two id fields.
  const [categoryIdEdit, setCategoryId] = useState<string | null | undefined>(undefined);
  const [descriptionEdit, setDescription] = useState<string | null>(null);
  const [variesEdit, setVaries] = useState<boolean | null>(null);
  const [amountEdit, setAmount] = useState<string | null>(null);
  const [paidByEdit, setPaidBy] = useState<string | null | undefined>(undefined);
  const [dayEdit, setDay] = useState<number | null>(null);
  const [activeEdit, setActive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoryId = categoryIdEdit !== undefined ? categoryIdEdit : (existing?.categoryId ?? null);
  const description = descriptionEdit ?? existing?.description ?? '';
  const varies = variesEdit ?? (existing ? existing.mode === 'confirm' : false);
  const amount = amountEdit ?? (existing?.amountPaise ? String(existing.amountPaise / 100) : '');
  // A new rule defaults to you as the payer, which the old effect did too.
  const paidBy =
    paidByEdit !== undefined ? paidByEdit : (existing?.paidBy ?? member?.id ?? null);
  const day = dayEdit ?? existing?.dayOfMonth ?? 1;
  const active = activeEdit ?? existing?.isActive ?? true;

  const amountPaise = parseAmount(amount);
  const canSave = !!categoryId && !!paidBy && (varies || !!amountPaise);

  /**
   * A rule never back-posts into a day that passed before it existed — so if
   * you set rent up on the 31st for the 1st, the first charge is next month.
   * Say so here rather than letting it look broken.
   */
  const nextPosting = useMemo(() => {
    const now = new Date();
    const monthOffset = day >= now.getDate() ? 0 : 1;
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, day);
    return target.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }, [day]);

  const categoryOptions: SelectOption[] = (categories.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    glyph: iconFor(c.icon),
    hint: c.respectsAwayCalendar
      ? 'Splits only between people who were here'
      : 'Everyone pays, away or not',
  }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        household_id: member!.household_id,
        category_id: categoryId,
        description: description.trim() || null,
        amount_paise: varies ? null : amountPaise,
        paid_by: paidBy,
        day_of_month: day,
        mode: varies ? 'confirm' : 'auto',
        is_active: active,
      };

      if (id) {
        const { error: upError } = await supabase
          .from('recurring_expenses')
          .update(payload)
          .eq('id', id);
        if (upError) throw upError;
      } else {
        const { error: insError } = await supabase
          .from('recurring_expenses')
          .insert({ ...payload, created_by: member!.id });
        if (insError) throw insError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.back();
    },
    onError: (e) => setError(humanError(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: delError } = await supabase.from('recurring_expenses').delete().eq('id', id!);
      if (delError) throw delError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.back();
    },
    onError: (e) => setError(humanError(e)),
  });

  function confirmRemove() {
    Alert.alert(
      'Delete this recurring expense?',
      'Expenses it has already posted stay exactly as they are — only future months stop.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
      ]
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScreenHeader title={id ? 'Edit recurring' : 'New recurring'} />

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Select
            label="Category"
            placeholder="Choose a category"
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
          />

          <TextField
            label="Name"
            value={description}
            onChangeText={setDescription}
            placeholder="Rent, Wifi, Maid…"
          />

          {/* The distinction that matters: a fixed amount can post itself; a
              varying one must never be guessed. */}
          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              AMOUNT
            </ThemedText>
            <View style={[styles.segment, { backgroundColor: theme.backgroundSunken }]}>
              {[
                { key: false, label: 'Same every month' },
                { key: true, label: 'Varies' },
              ].map((opt) => {
                const selected = varies === opt.key;
                return (
                  <Pressable
                    key={String(opt.key)}
                    onPress={() => setVaries(opt.key)}
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
            </View>

            {varies ? (
              <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
                <Ionicons name="hand-left-outline" size={14} color={theme.warning} />
                <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flex]}>
                  You&apos;ll be asked for the amount each month rather than the app guessing —
                  right for electricity and water.
                </ThemedText>
              </View>
            ) : (
              <View
                style={[
                  styles.amountBox,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}>
                <ThemedText themeColor="textTertiary" style={styles.currency}>
                  ₹
                </ThemedText>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: theme.text }]}
                />
              </View>
            )}
          </View>

          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              WHO PAYS IT
            </ThemedText>
            {/* A member may set up a bill they pay themselves — "I buy the
                water can" — but committing somebody ELSE to paying every month
                is the owner's call. The policy in migration 0031 enforces it;
                this just avoids offering a choice that would be refused. */}
            {!isOwner ? (
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                You can set up a bill you pay. Ask the owner to add one somebody else pays.
              </ThemedText>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.payerRow}>
              {(isOwner ? members.data : members.data?.filter((m) => m.id === member?.id))?.map(
                (m) => {
                const selected = m.id === paidBy;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setPaidBy(m.id)}
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
                }
              )}
            </ScrollView>
          </View>

          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              POSTS ON DAY
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.dayRow}>
              {DAYS.map((d) => {
                const selected = d === day;
                return (
                  <Pressable
                    key={d}
                    onPress={() => setDay(d)}
                    style={[
                      styles.day,
                      {
                        backgroundColor: selected ? theme.primary : theme.backgroundElement,
                        borderColor: selected ? theme.primary : theme.border,
                      },
                    ]}>
                    <ThemedText
                      style={[
                        Type.caption,
                        { color: selected ? theme.onPrimary : theme.text, fontWeight: '600' },
                      ]}>
                      {d}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="calendar-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                {id ? 'Next posts' : 'First posts'} on{' '}
                <ThemedText style={[Type.micro, styles.semi]}>{nextPosting}</ThemedText>. Days are
                capped at the 28th so every month has one.
              </ThemedText>
            </View>
          </View>

          {id ? (
            <Pressable onPress={() => setActive(!active)} style={styles.toggleRow}>
              <Ionicons
                name={active ? 'checkbox' : 'square-outline'}
                size={20}
                color={active ? theme.primary : theme.borderStrong}
              />
              <View style={styles.flex}>
                <ThemedText style={Type.body}>Active</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  Pause it instead of deleting if the bill is on hold
                </ThemedText>
              </View>
            </Pressable>
          ) : null}

          {error ? (
            <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
              <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          <Button
            title={
              !varies && amountPaise ? `Save ${formatPaise(amountPaise)} monthly` : 'Save'
            }
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!canSave}
          />

          {id ? (
            <Button
              title="Delete"
              variant="danger"
              onPress={confirmRemove}
              loading={remove.isPending}
            />
          ) : null}
        </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  semi: { fontWeight: '700' },
  dim: { opacity: 0.4 },

  field: { gap: Spacing.two },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
  },

  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    minHeight: 56,
  },
  currency: { fontSize: 22, fontWeight: '600' },
  amountInput: { flex: 1, minWidth: 0, fontSize: 26, fontWeight: '700', padding: 0 },

  payerRow: { gap: Spacing.four, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  payer: { alignItems: 'center', gap: Spacing.two, width: 60 },

  dayRow: { gap: Spacing.two, paddingRight: Spacing.four },
  day: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
});
