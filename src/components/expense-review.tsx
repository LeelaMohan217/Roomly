import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel } from '@/lib/dates';
import { categoryColor, categoryIcon, tintOf } from '@/lib/icons';
import { formatPaise } from '@/lib/money';

export type ReviewShare = { id: string; name: string; amountPaise: number; isMe: boolean };

/**
 * The last look before an expense goes to the whole house, laid out like a
 * bill: the amount, what for, who paid and when, then each person's share.
 * Two ways out: change something (back to the form, nothing lost) or good to
 * go (save).
 *
 * A mis-keyed ₹2400 for ₹240 is the mistake that costs everyone; this is
 * where it gets caught, before anyone's balance moves.
 */
export function ExpenseReview({
  visible,
  heading = 'Check before adding',
  amountPaise,
  description,
  categoryName,
  categorySlug = null,
  icon,
  iconColor,
  payerName,
  date,
  shares,
  note,
  busy,
  onEdit,
  onConfirm,
}: {
  visible: boolean;
  /** The small line over the amount: "Check before adding", "Check your changes". */
  heading?: string;
  amountPaise: number;
  description: string;
  categoryName: string;
  /** A house category's stored slug: its icon and colour. */
  categorySlug?: string | null;
  /** Or an icon and colour of its own, as My ledger's categories have. */
  icon?: IconName;
  iconColor?: string;
  /** Who paid, and the split: a house expense only. */
  payerName?: string;
  date: string;
  shares?: ReviewShare[];
  /** A line at the foot of the bill in place of the split: "Only you can see this". */
  note?: string;
  busy: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const tileIcon = icon ?? categoryIcon(categorySlug);
  const tileColor = iconColor ?? categoryColor(categorySlug);
  const theme = useTheme();
  const day = dayLabel(date);
  const full = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const when = day === 'Today' || day === 'Yesterday' ? `${day}, ${full}` : full;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onEdit} statusBarTranslucent>
      <Pressable accessibilityLabel="Change something" style={styles.backdrop} onPress={busy ? undefined : onEdit} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.bill, { backgroundColor: theme.backgroundElement }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.billInner}>
            {/* Head: the category, the amount, what it was for. */}
            <View style={styles.head}>
              <View style={[styles.catIcon, { backgroundColor: tintOf(tileColor) }]}>
                <Icon name={tileIcon} size={22} color={tileColor} />
              </View>
              <ThemedText themeColor="textSecondary" style={Type.caption}>
                {heading}
              </ThemedText>
              <Money paise={amountPaise} size="hero" />
              <ThemedText style={[Type.body, styles.semi, styles.centerText]} numberOfLines={2}>
                {description.trim() || categoryName}
              </ThemedText>
            </View>

            <Perforation />

            <View style={styles.rows}>
              <Row label="Category" value={categoryName} />
              {payerName ? <Row label="Paid by" value={payerName} /> : null}
              <Row label="Date" value={when} />
            </View>

            {note ? (
              <>
                <Perforation />
                <View style={[styles.rows, styles.noteRow]}>
                  <Icon name="lock-closed-outline" size={14} color={theme.textTertiary} />
                  <ThemedText themeColor="textTertiary" style={Type.caption}>
                    {note}
                  </ThemedText>
                </View>
              </>
            ) : null}

            {shares ? (
            <>
            <Perforation />

            <View style={styles.rows}>
              <View style={styles.splitHead}>
                <ThemedText style={[Type.caption, styles.semi]}>
                  Split {shares.length === 1 ? 'with 1 person' : `${shares.length} ways`}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  Share
                </ThemedText>
              </View>
              {shares.map((s) => (
                <View key={s.id} style={styles.share}>
                  <Avatar name={s.name} seed={s.id} size={26} />
                  <ThemedText
                    style={[Type.body, styles.flex, s.isMe && styles.semi]}
                    numberOfLines={1}>
                    {s.isMe ? `${s.name} (you)` : s.name}
                  </ThemedText>
                  <ThemedText style={[Type.body, s.isMe && styles.semi]}>
                    {formatPaise(s.amountPaise)}
                  </ThemedText>
                </View>
              ))}
              <View style={[styles.total, { borderTopColor: theme.border }]}>
                <ThemedText style={[Type.body, styles.semi, styles.flex]}>Total</ThemedText>
                <ThemedText style={[Type.body, styles.semi]}>{formatPaise(amountPaise)}</ThemedText>
              </View>
            </View>
            </>
            ) : null}
          </ScrollView>

          {/* The bill's torn edge: a row of half-circles in the page colour. */}
          <View style={styles.teeth} pointerEvents="none">
            {Array.from({ length: 18 }, (_, i) => (
              <View key={i} style={[styles.tooth, { backgroundColor: BACKDROP }]} />
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            title="Good to go"
            onPress={onConfirm}
            loading={busy}
            disabled={busy}
            style={styles.primary}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onEdit}
            disabled={busy}
            style={({ pressed }) => [
              styles.secondary,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Icon name="create-outline" size={16} color={theme.brandInk} />
            <ThemedText style={[Type.body, styles.semi, { color: theme.brandInk }]}>
              Want to change anything?
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText themeColor="textSecondary" style={Type.body}>
        {label}
      </ThemedText>
      <ThemedText style={[Type.body, styles.semi, styles.rowValue]} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

/** A dashed line with a notch cut into each side, like a tear-off bill. */
function Perforation() {
  const theme = useTheme();
  return (
    <View style={styles.perf}>
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.dash, { borderColor: theme.borderStrong }]} />
      <View style={[styles.notch, styles.notchRight]} />
    </View>
  );
}

const BACKDROP = 'rgba(12,14,18,0.72)';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  centerText: { textAlign: 'center' },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: BACKDROP },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },

  bill: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  billInner: { paddingTop: Spacing.four, paddingBottom: Spacing.four + 6 },
  head: { alignItems: 'center', gap: 4, paddingHorizontal: Spacing.four },
  catIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },

  perf: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.three },
  notch: { width: 20, height: 20, borderRadius: 10, backgroundColor: BACKDROP },
  notchLeft: { marginLeft: -10 },
  notchRight: { marginRight: -10 },
  dash: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', marginHorizontal: Spacing.two },

  rows: { paddingHorizontal: Spacing.four, gap: Spacing.two + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowValue: { flex: 1, textAlign: 'right' },
  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  splitHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  share: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
    marginTop: Spacing.one,
  },

  teeth: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  tooth: { width: 14, height: 14, borderRadius: 7 },

  actions: { gap: Spacing.two },
  primary: { minHeight: 54, borderRadius: 999 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: 999,
  },
});
