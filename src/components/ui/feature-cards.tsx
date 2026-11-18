import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { useTourTarget, type TourTarget } from '@/lib/tour';
import { Icon, type IconName } from '@/components/ui/icon';

export type FeatureCard = {
  key: string;
  icon: IconName;
  /** Two short lines read best: "My private\nledger". */
  label: string;
  /** One short grey line under the label, saying what the card is for. */
  caption?: string;
  /**
   * The card's own hue, as six-digit hex. The card is a faint wash of it, the
   * icon drawn in it on a stronger wash. Mid tones read on light and dark.
   */
  color?: string;
  /** Drawn in the app's deep green, like the balance card, to stand out. */
  featured?: boolean;
  /** The corner tag: "New", "Premium". Omit for none. */
  tag?: string;
  /** Names this card's icon as a stop on the first-run tour. */
  tourTarget?: TourTarget;
  onPress: () => void;
};

/**
 * A row of small cards: Home's everyday actions, then features people would
 * not find on their own. Scrolls sideways once there are more than fit; each
 * card carries an optional tag in its top-right corner.
 */
export function FeatureCards({
  cards,
  bleed = 0,
}: {
  cards: FeatureCard[];
  /** The page's side margin: the row then scrolls to the screen's edges, with
   * its first card still lined up with the page. */
  bleed?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={bleed ? { marginHorizontal: -bleed } : null}
      contentContainerStyle={[styles.row, bleed ? { paddingHorizontal: bleed } : null]}>
      {cards.map((c) => (
        <Card key={c.key} card={c} />
      ))}
    </ScrollView>
  );
}

/** Its own component so each card can be a tour stop. */
function Card({ card: c }: { card: FeatureCard }) {
  const theme = useTheme();
  const ref = useTourTarget(c.tourTarget);

  const hue = c.color ?? theme.brandInk;
  const ink = c.featured ? theme.onWash : hue;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.label.replace('\n', ' ')}${c.tag ? `, ${c.tag}` : ''}`}
      onPress={() => {
        tapped();
        c.onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        c.featured
          ? { borderColor: 'transparent' }
          : {
              backgroundColor: c.color ? `${hue}14` : theme.backgroundElement,
              borderColor: c.color ? `${hue}2E` : theme.liftEdge,
            },
        { opacity: pressed ? 0.7 : 1 },
      ]}>
      {c.featured ? (
        <LinearGradient
          pointerEvents="none"
          colors={[theme.washTop, theme.washMid, theme.washLow]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {c.tag ? (
        <View
          style={[
            styles.tag,
            { backgroundColor: c.featured ? theme.onWash : (c.color ?? theme.primary) },
          ]}>
          <ThemedText
            style={[styles.tagText, { color: c.featured ? theme.washTop : theme.onPrimary }]}>
            {c.tag}
          </ThemedText>
        </View>
      ) : null}
      <View
        ref={ref}
        collapsable={false}
        style={[
          styles.icon,
          {
            backgroundColor: c.featured
              ? 'rgba(255,255,255,0.16)'
              : c.color
                ? `${hue}24`
                : theme.primarySoft,
          },
        ]}>
        <Icon name={c.icon} size={19} color={ink} />
      </View>
      <View style={styles.words}>
        <ThemedText
          style={[styles.label, c.featured ? { color: theme.onWash } : null]}
          numberOfLines={2}>
          {c.label}
        </ThemedText>
        {c.caption ? (
          <ThemedText
            themeColor="textSecondary"
            style={[styles.caption, c.featured ? { color: theme.onWashMuted } : null]}
            numberOfLines={1}>
            {c.caption}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two },
  card: {
    width: 124,
    minHeight: 104,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    justifyContent: 'space-between',
    gap: Spacing.two,
    overflow: 'hidden',
  },
  tag: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderBottomLeftRadius: Radius.sm,
  },
  tagText: { fontSize: 10.5, lineHeight: 14, fontWeight: '600' },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  words: { gap: 1 },
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: '600', letterSpacing: -0.2 },
  caption: { fontSize: 11.5, lineHeight: 15 },
});
