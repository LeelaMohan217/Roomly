import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonthCalendarPopover, monthLabel, prevMonth, type Month } from '@/components/month-popover';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { LoadFailed } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel } from '@/lib/dates';
import { compareMonths, mainDrivers, type CategoryChange } from '@/lib/ledger-compare';
import { formatWholeRupees } from '@/lib/money';
import { personalCategory, tintOf, usePersonalPeriod } from '@/lib/personal';

/** "2026-11" back into a month; anything else is null. */
function parseMonth(s: string | string[] | undefined): Month | null {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

type Line = { icon: IconName; tone: 'up' | 'down' | 'plain'; text: string };

/**
 * Compare months: any two months of the private ledger side by side. How
 * much the total moved, in plain sentences why -- which categories drove it,
 * which went the other way, what was new -- and every category's two figures.
 */
export default function LedgerCompareScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ first?: string; second?: string }>();
  const now: Month = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

  const [first, setFirst] = useState<Month>(parseMonth(params.first) ?? prevMonth(now));
  const [second, setSecond] = useState<Month>(parseMonth(params.second) ?? now);

  // Which month's calendar is open, and where it drops down from.
  const [picking, setPicking] = useState<{ which: 'first' | 'second'; top: number } | null>(null);
  const firstRef = useRef<View>(null);
  const secondRef = useRef<View>(null);
  const openPicker = (which: 'first' | 'second') => {
    const ref = (which === 'first' ? firstRef : secondRef).current;
    if (!ref) return setPicking({ which, top: 140 });
    ref.measureInWindow((_x, y, _w, h) => setPicking({ which, top: y + h + Spacing.two }));
  };

  const a = usePersonalPeriod(first);
  const b = usePersonalPeriod(second);
  const ready = a.data && b.data;
  const cmp = ready ? compareMonths(a.data!.expenses, b.data!.expenses) : null;

  const firstName = monthLabel(first);
  const secondName = monthLabel(second);
  const same = first.year === second.year && first.month === second.month;
  const failed = a.error ?? b.error;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Compare months" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* The two months, each its own button. */}
        <View style={styles.pickers}>
          <MonthButton
            refEl={firstRef}
            label={monthLabel(first, false)}
            onPress={() => openPicker('first')}
          />
          <ThemedText themeColor="textTertiary" style={[Type.caption, styles.semi]}>
            vs
          </ThemedText>
          <MonthButton
            refEl={secondRef}
            label={monthLabel(second, false)}
            onPress={() => openPicker('second')}
          />
        </View>

        {failed && !ready ? (
          <LoadFailed
            what="your ledger"
            error={failed}
            onRetry={() => {
              void a.refetch();
              void b.refetch();
            }}
          />
        ) : null}

        {/* The difference, on the same bright green as My ledger's card. */}
        <LinearGradient
          colors={['#1DB584', '#0E9A6C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <ThemedText style={[Type.caption, styles.onCardMuted]} numberOfLines={1}>
            {secondName} against {firstName}
          </ThemedText>
          {cmp ? (
            <>
              <Money paise={cmp.diffPaise} signed size="hero" color="#FFFFFF" />
              <ThemedText style={[Type.caption, styles.onCard]}>
                {same
                  ? 'The same month twice. Pick another to compare.'
                  : cmp.diffPaise === 0
                    ? 'Exactly the same as ' + firstName
                    : `${cmp.diffPaise > 0 ? 'More' : 'Less'} than in ${firstName}${
                        cmp.percent !== null ? ` · ${Math.abs(cmp.percent)}%` : ''
                      }`}
              </ThemedText>
              <View style={styles.heroFoot}>
                <Total name={firstName} paise={cmp.firstPaise} />
                <View style={styles.heroDivider} />
                <Total name={secondName} paise={cmp.secondPaise} />
              </View>
            </>
          ) : (
            <View style={styles.heroSkeleton}>
              <Skeleton width="55%" height={42} radius={Radius.sm} tint={theme.frost} />
            </View>
          )}
        </LinearGradient>

        {cmp && !same && cmp.categories.length > 0 ? (
          <>
            <ThemedText style={styles.sectionTitle}>Why it changed</ThemedText>
            <Card style={styles.why}>
              {explain(cmp, firstName, secondName).map((l, i) => (
                <View key={i} style={styles.whyRow}>
                  <View
                    style={[
                      styles.whyIcon,
                      {
                        backgroundColor:
                          l.tone === 'up'
                            ? theme.dangerSoft
                            : l.tone === 'down'
                              ? theme.successSoft
                              : theme.primarySoft,
                      },
                    ]}>
                    <Icon
                      name={l.icon}
                      size={16}
                      color={
                        l.tone === 'up'
                          ? theme.danger
                          : l.tone === 'down'
                            ? theme.positive
                            : theme.brandInk
                      }
                    />
                  </View>
                  <ThemedText style={[Type.body, styles.flex]}>{l.text}</ThemedText>
                </View>
              ))}
            </Card>

            <ThemedText style={styles.sectionTitle}>By category</ThemedText>
            <Card padded={false}>
              {cmp.categories.map((c, i) => (
                <CategoryRow
                  key={c.slug}
                  change={c}
                  max={Math.max(...cmp.categories.map((x) => Math.max(x.firstPaise, x.secondPaise)))}
                  first={i === 0}
                />
              ))}
              <View style={[styles.legend, { borderTopColor: theme.border }]}>
                <LegendDot color={theme.textTertiary} label={firstName} />
                <LegendDot color={theme.primary} label={secondName} />
              </View>
            </Card>
          </>
        ) : null}

        {cmp && cmp.categories.length === 0 ? (
          <Card style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon name="bar-chart-outline" size={24} color={theme.brandInk} />
            </View>
            <ThemedText style={[Type.headline, styles.center]}>Nothing to compare yet</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.center]}>
              Neither {firstName} nor {secondName} has anything logged. Pick other months, or add
              expenses first.
            </ThemedText>
          </Card>
        ) : null}
      </ScrollView>

      {picking ? (
        <MonthCalendarPopover
          anchorTop={picking.top}
          align={picking.which === 'first' ? 'left' : 'right'}
          shown={picking.which === 'first' ? first : second}
          onPick={(m) => {
            if (picking.which === 'first') setFirst(m);
            else setSecond(m);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The comparison in plain sentences: the headline, what drove it, what went
 * the other way, anything new or dropped, and the second month's biggest
 * payment.
 */
function explain(
  cmp: ReturnType<typeof compareMonths>,
  firstName: string,
  secondName: string
): Line[] {
  const lines: Line[] = [];
  const rupees = formatWholeRupees;
  const label = (c: CategoryChange) => personalCategory(c.slug).label;

  const drivers = mainDrivers(cmp);
  if (cmp.diffPaise !== 0) {
    const up = cmp.diffPaise > 0;
    const names = drivers.map(label);
    lines.push({
      icon: up ? 'trending-up' : 'trending-down',
      tone: up ? 'up' : 'down',
      text:
        `You spent ${rupees(Math.abs(cmp.diffPaise))} ${up ? 'more' : 'less'} in ${secondName} than in ${firstName}` +
        (names.length ? `, mostly ${up ? 'on' : 'from'} ${names.join(' and ')}.` : '.'),
    });
  } else {
    lines.push({ icon: 'checkmark', tone: 'plain', text: `You spent the same in both months.` });
  }

  for (const c of drivers) {
    const isNew = c.firstPaise === 0;
    const gone = c.secondPaise === 0;
    lines.push({
      icon: c.diffPaise > 0 ? 'arrow-up' : 'arrow-down',
      tone: c.diffPaise > 0 ? 'up' : 'down',
      text: isNew
        ? `${label(c)} is new: ${rupees(c.secondPaise)} in ${secondName}, nothing in ${firstName}.`
        : gone
          ? `No ${label(c)} in ${secondName}, against ${rupees(c.firstPaise)} in ${firstName}.`
          : `${label(c)} went ${c.diffPaise > 0 ? 'up' : 'down'} ${rupees(Math.abs(c.diffPaise))}, from ${rupees(c.firstPaise)} to ${rupees(c.secondPaise)}.`,
    });
  }

  // The other direction: what offset the change, at most two.
  const others = (cmp.diffPaise >= 0 ? cmp.down : cmp.up).slice(0, 2);
  for (const c of others) {
    lines.push({
      icon: c.diffPaise > 0 ? 'arrow-up' : 'arrow-down',
      tone: c.diffPaise > 0 ? 'up' : 'down',
      text:
        c.diffPaise < 0
          ? `You spent ${rupees(-c.diffPaise)} less on ${label(c)}.`
          : `${label(c)} went up ${rupees(c.diffPaise)}.`,
    });
  }

  const top = cmp.biggest[0];
  if (top) {
    const day = dayLabel(top.spentOn);
    const when = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`;
    lines.push({
      icon: 'receipt',
      tone: 'plain',
      text: `Biggest payment in ${secondName}: ${top.description}, ${rupees(top.amountPaise)} ${when}.`,
    });
  }
  return lines;
}

function MonthButton({
  refEl,
  label,
  onPress,
}: {
  refEl: React.RefObject<View | null>;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      ref={refEl}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change month`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.monthButton,
        { backgroundColor: theme.lift, borderColor: theme.liftEdge, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Icon name="calendar-outline" size={16} color={theme.brandInk} />
      <ThemedText style={[Type.body, styles.semi, styles.flex]} numberOfLines={1}>
        {label}
      </ThemedText>
      <Icon name="chevron-down" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

function Total({ name, paise }: { name: string; paise: number }) {
  return (
    <View style={styles.flex}>
      <ThemedText style={[Type.micro, styles.onCardMuted]} numberOfLines={1}>
        {name}
      </ThemedText>
      <ThemedText style={[Type.headline, styles.onCard]}>{formatWholeRupees(paise)}</ThemedText>
    </View>
  );
}

/** A category's two months: figures, the change, and a bar each. */
function CategoryRow({ change: c, max, first }: { change: CategoryChange; max: number; first: boolean }) {
  const theme = useTheme();
  const cat = personalCategory(c.slug);
  const width = (p: number) => `${Math.max(p > 0 ? 3 : 0, (p / (max || 1)) * 100)}%` as const;
  return (
    <View
      style={[
        styles.catRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
      ]}>
      <View style={[styles.catIcon, { backgroundColor: tintOf(cat.color) }]}>
        <Icon name={cat.icon} size={18} color={cat.color} />
      </View>
      <View style={[styles.flex, styles.catBody]}>
        <View style={styles.catTop}>
          <ThemedText style={[Type.body, styles.semi, styles.flex]} numberOfLines={1}>
            {cat.label}
          </ThemedText>
          <ThemedText
            style={[
              Type.caption,
              styles.semi,
              {
                color:
                  c.diffPaise > 0 ? theme.danger : c.diffPaise < 0 ? theme.positive : theme.textTertiary,
              },
            ]}>
            {c.diffPaise === 0
              ? 'No change'
              : `${c.diffPaise > 0 ? '+' : '−'} ${formatWholeRupees(Math.abs(c.diffPaise))}`}
          </ThemedText>
        </View>
        <View style={styles.bars}>
          <View style={[styles.track, { backgroundColor: theme.backgroundSunken }]}>
            <View
              style={[styles.bar, { width: width(c.firstPaise), backgroundColor: theme.textTertiary }]}
            />
          </View>
          <View style={[styles.track, { backgroundColor: theme.backgroundSunken }]}>
            <View style={[styles.bar, { width: width(c.secondPaise), backgroundColor: theme.primary }]} />
          </View>
        </View>
        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {formatWholeRupees(c.firstPaise)} → {formatWholeRupees(c.secondPaise)}
        </ThemedText>
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <ThemedText themeColor="textSecondary" style={Type.micro}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  center: { textAlign: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },

  pickers: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  monthButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 46,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.four - 4,
    gap: Spacing.one,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -90,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroSkeleton: { paddingVertical: Spacing.one },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
    paddingTop: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.3)',
  },
  heroDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.3)' },
  onCard: { color: '#FFFFFF' },
  onCardMuted: { color: 'rgba(255,255,255,0.8)' },

  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: -Spacing.one,
  },
  why: { gap: Spacing.three },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  whyIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  catRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  catIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catBody: { gap: 6 },
  catTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bars: { gap: 4 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  legend: {
    flexDirection: 'row',
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },

  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
