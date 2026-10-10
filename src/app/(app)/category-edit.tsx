import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { ICON_SLUGS, iconFor } from '@/lib/icons';
import { useAllCategories } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Kind = 'fixed' | 'bulk' | 'consumption';

const KINDS: { kind: Kind; label: string; blurb: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  {
    kind: 'fixed',
    label: 'Fixed cost',
    blurb: 'Rent, wifi, maid. Split between everyone whether they were here or not.',
    icon: 'home',
  },
  {
    kind: 'bulk',
    label: 'Bulk buy',
    blurb: 'Gas cylinder, rice sack. Charged in full when bought — it outlasts any one trip.',
    icon: 'cube',
  },
  {
    kind: 'consumption',
    label: 'Day to day',
    blurb: 'Milk, vegetables, eating out. Split only between people who were actually here.',
    icon: 'basket',
  },
];

export default function CategoryEditScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const categories = useAllCategories();
  const existing = id ? categories.data?.find((c) => c.id === id) : undefined;

  // Derived, not hydrated by an effect. Calling setState synchronously inside
  // an effect is what the React Compiler flagged: the data arrives, the effect
  // fires, state changes, everything re-renders. Instead each field holds only
  // what the user has actually EDITED -- null until then -- and falls back to
  // the loaded record. No effect, no `hydrated` latch, and no window where the
  // form shows blanks after the record has arrived.
  const [nameEdit, setName] = useState<string | null>(null);
  const [iconEdit, setIcon] = useState<string | null>(null);
  const [kindEdit, setKind] = useState<Kind | null>(null);
  const [archivedEdit, setArchived] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = nameEdit ?? existing?.name ?? '';
  const icon = iconEdit ?? existing?.icon ?? 'misc';
  // 'asset' is a real kind in the database but not offered in this form.
  const kind: Kind =
    kindEdit ?? (existing ? (existing.kind === 'asset' ? 'bulk' : existing.kind) : 'consumption');
  const archived = archivedEdit ?? existing?.isArchived ?? false;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        household_id: member!.household_id,
        name: name.trim(),
        icon,
        kind,
        // Derived, never asked separately: a category's kind IS its split rule,
        // and letting the two disagree is how an expense ends up split wrong.
        respects_away_calendar: kind === 'consumption',
        is_archived: archived,
      };

      if (id) {
        const { error: upError } = await supabase
          .from('categories')
          .update(payload)
          .eq('id', id);
        if (upError) throw upError;
      } else {
        const { error: insError } = await supabase.from('categories').insert({
          ...payload,
          sort_order: (categories.data?.length ?? 0) + 1,
        });
        if (insError) throw insError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.back();
    },
    onError: (e) => {
      const msg = humanError(e);
      setError(
        msg.includes('categories_household_id_name_key') || msg.includes('duplicate')
          ? 'A category with that name already exists.'
          : msg
      );
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: delError } = await supabase.from('categories').delete().eq('id', id!);
      if (delError) {
        if (delError.code === '23503') {
          throw new Error(
            'Expenses already use this category, so it cannot be deleted. Archive it instead — old expenses keep their category and it disappears from the picker.'
          );
        }
        throw delError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.back();
    },
    onError: (e) => setError(humanError(e)),
  });

  function confirmRemove() {
    Alert.alert('Delete this category?', 'Only possible if no expense has ever used it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  }

  const inUse = (existing?.expenseCount ?? 0) > 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScreenHeader title={id ? 'Edit category' : 'New category'} />

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Card style={styles.preview}>
            <View style={[styles.previewTile, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText style={styles.previewGlyph}>{iconFor(icon)}</ThemedText>
            </View>
            <ThemedText style={Type.title}>{name.trim() || 'New category'}</ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              {kind === 'consumption'
                ? 'Splits only between people who were here'
                : 'Everyone pays, away or not'}
            </ThemedText>
          </Card>

          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Gym, Water can, Cook…"
            autoCapitalize="words"
          />

          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              ICON
            </ThemedText>
            <Card padded={false} style={styles.iconGrid}>
              {ICON_SLUGS.map((slug) => {
                const selected = slug === icon;
                return (
                  <Pressable
                    key={slug}
                    onPress={() => setIcon(slug)}
                    style={[
                      styles.iconCell,
                      {
                        backgroundColor: selected ? theme.primarySoft : 'transparent',
                        borderColor: selected ? theme.primary : 'transparent',
                      },
                    ]}>
                    <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(slug)}</ThemedText>
                  </Pressable>
                );
              })}
            </Card>
          </View>

          {/* The kind IS the split rule. This is the single most consequential
              choice on the screen, so each option explains what it does. */}
          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              HOW IT SPLITS
            </ThemedText>

            {KINDS.map((k) => {
              const selected = kind === k.kind;
              return (
                <Pressable
                  key={k.kind}
                  onPress={() => setKind(k.kind)}
                  style={({ pressed }) => [
                    styles.kindRow,
                    {
                      backgroundColor: selected ? theme.primarySoft : theme.backgroundElement,
                      borderColor: selected ? theme.primary : theme.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}>
                  <Ionicons
                    name={k.icon}
                    size={18}
                    color={selected ? theme.primary : theme.textSecondary}
                  />
                  <View style={styles.flex}>
                    <ThemedText style={Type.body}>{k.label}</ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {k.blurb}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selected ? theme.primary : theme.borderStrong}
                  />
                </Pressable>
              );
            })}
          </View>

          {id ? (
            <Pressable onPress={() => setArchived(!archived)} style={styles.toggleRow}>
              <Ionicons
                name={archived ? 'checkbox' : 'square-outline'}
                size={20}
                color={archived ? theme.primary : theme.borderStrong}
              />
              <View style={styles.flex}>
                <ThemedText style={Type.body}>Archived</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  Hidden when adding an expense. Old expenses keep it.
                </ThemedText>
              </View>
            </Pressable>
          ) : null}

          {id && inUse ? (
            <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
              <Ionicons name="information-circle-outline" size={14} color={theme.warning} />
              <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flex]}>
                Changing how this splits affects{' '}
                <ThemedText style={[Type.micro, styles.semi]}>new expenses only</ThemedText>.
                Everything already recorded keeps the split it was saved with — balances people
                have already settled never move.
              </ThemedText>
            </View>
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
            title="Save"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim()}
          />

          {id && !inUse ? (
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

  preview: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.four },
  previewTile: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  previewGlyph: { fontSize: 26 },

  field: { gap: Spacing.two },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: Spacing.two,
    gap: Spacing.one,
  },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 20 },

  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
});
