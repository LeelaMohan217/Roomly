import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import {
  completeTour,
  getTourTarget,
  startTour,
  TOUR_STEPS,
  useTourStore,
  type TourTarget,
} from '@/lib/tour';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The dimmed page around the spotlight. The dialog's scrim, a touch deeper. */
const SCRIM = 'rgba(0,0,0,0.62)';
/** Room between the target's edge and the spotlight's. */
const HOLE_PAD = 6;
/** Between the spotlight and the tooltip, where the caret sits. */
const GAP = 14;
const CARET = 14;
/** Side margin, and the widest the tooltip gets on a big phone. */
const SIDE = 16;
const MAX_CARD = 360;
/** Lets Home's cards finish rising into place before they are measured. */
const START_DELAY_MS = 900;

type Rect = { x: number; y: number; w: number; h: number; r: number };

/** A rounded rectangle as an SVG path, so it can be cut out of the scrim. */
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  'worklet';
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    `V${y + h - rr}A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}` +
    `H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}` +
    `V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`
  );
}

function measure(view: View): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * The first-run tour over the tab shell: the page dims, a spotlight opens
 * over one thing at a time, and a small card beside it says what it is.
 *
 * Drawn as an absolute layer in the tab layout rather than a Modal, so the
 * spotlight and the views it points at share one coordinate space -- both are
 * measured with measureInWindow and the layer's own origin is subtracted.
 * It takes every touch while it is up: tapping through to the page mid-tour
 * would leave the tour pointing at a screen that is no longer there.
 */
export function GuidedTour() {
  const status = useTourStore((s) => s.status);
  const homeReady = useTourStore((s) => s.homeReady);

  // Start once Home is up and has settled. Pending is decided per account
  // (see lib/tour); this only picks the moment.
  useEffect(() => {
    if (status !== 'pending' || !homeReady) return;
    const timer = setTimeout(startTour, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, homeReady]);

  if (status !== 'active') return null;
  return <TourOverlay />;
}

function TourOverlay() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduced = useReducedMotion();
  const rootRef = useRef<View>(null);

  const [index, setIndex] = useState(0);
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [hole, setHole] = useState<Rect | null>(null);
  const [measured, setMeasured] = useState(false);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  // The spotlight's rectangle, eased from one target to the next.
  const hx = useSharedValue(0);
  const hy = useSharedValue(0);
  const hw = useSharedValue(0);
  const hh = useSharedValue(0);
  const hr = useSharedValue(0);

  const locate = useCallback(
    async (target: TourTarget) => {
      const view = getTourTarget(target);
      const root = rootRef.current;
      const [box, origin] = await Promise.all([
        view ? measure(view) : Promise.resolve(null),
        root ? measure(root) : Promise.resolve(null),
      ]);
      const next: Rect | null =
        box && origin
          ? {
              x: box.x - origin.x - HOLE_PAD,
              y: box.y - origin.y - HOLE_PAD,
              w: box.w + HOLE_PAD * 2,
              h: box.h + HOLE_PAD * 2,
              // Round things get a round spotlight; cards keep soft corners.
              r: Math.abs(box.w - box.h) < 8 ? (box.w + HOLE_PAD * 2) / 2 : 24,
            }
          : null;

      setHole(next);
      setMeasured(true);
      if (!next) return;
      const timing = { duration: 280, easing: Easing.out(Easing.cubic) };
      // The first one appears where it is; after that it travels.
      const animate = !reduced && hw.get() > 0;
      hx.set(animate ? withTiming(next.x, timing) : next.x);
      hy.set(animate ? withTiming(next.y, timing) : next.y);
      hw.set(animate ? withTiming(next.w, timing) : next.w);
      hh.set(animate ? withTiming(next.h, timing) : next.h);
      hr.set(animate ? withTiming(next.r, timing) : next.r);
    },
    [reduced, hx, hy, hw, hh, hr]
  );

  // Re-measured on every step and whenever the window changes shape.
  useEffect(() => {
    void locate(step.target);
  }, [locate, step.target, window.width, window.height]);

  const finish = useCallback(() => {
    void completeTour();
  }, []);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const next = useCallback(() => {
    tapped();
    if (last) finish();
    else setIndex((i) => i + 1);
  }, [last, finish]);

  // Android's back button steps back, and on the first step leaves the tour.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index > 0) back();
      else finish();
      return true;
    });
    return () => sub.remove();
  }, [index, back, finish]);

  const { width, height } = size;
  const scrimProps = useAnimatedProps(() => ({
    d:
      `M0 0H${width}V${height}H0Z` +
      (hw.get() > 0 ? roundedRect(hx.get(), hy.get(), hw.get(), hh.get(), hr.get()) : ''),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    left: hx.get(),
    top: hy.get(),
    width: hw.get(),
    height: hh.get(),
    borderRadius: hr.get(),
    opacity: hw.get() > 0 ? 1 : 0,
  }));

  // Where the card goes: under the target if it fits there (or there is more
  // room there than above), otherwise over it. Kept inside the safe area.
  const cardWidth = Math.min(width - SIDE * 2, MAX_CARD);
  const estHeight = cardHeight ?? 180;
  const topLimit = insets.top + Spacing.three;
  const bottomLimit = height - insets.bottom - Spacing.three;

  let cardTop: number;
  let cardLeft = (width - cardWidth) / 2;
  let below = true;
  let caretX = cardWidth / 2 - CARET / 2;
  if (hole) {
    const spaceAbove = hole.y - topLimit;
    const spaceBelow = bottomLimit - (hole.y + hole.h);
    below = spaceBelow >= estHeight + GAP || spaceBelow >= spaceAbove;
    cardTop = below ? hole.y + hole.h + GAP : hole.y - GAP - estHeight;
    const centerX = hole.x + hole.w / 2;
    cardLeft = Math.min(Math.max(centerX - cardWidth / 2, SIDE), width - SIDE - cardWidth);
    caretX = Math.min(Math.max(centerX - cardLeft - CARET / 2, Radius.xl), cardWidth - Radius.xl - CARET);
  } else {
    cardTop = (height - estHeight) / 2;
  }
  cardTop = Math.min(Math.max(cardTop, topLimit), bottomLimit - estHeight);

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== size.width || h !== size.height) setSize({ width: w, height: h });
  };

  const onCardLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h !== cardHeight) setCardHeight(h);
  };

  const ready = measured && cardHeight !== null;

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      onLayout={onRootLayout}
      style={styles.root}
      accessibilityViewIsModal
      // Takes every touch, so nothing behind it can be pressed mid-tour.
      onStartShouldSetResponder={() => true}>
      {/* A plain view to measure from: the layer's own origin in the window,
          taken off every target so the two line up whatever sits above. */}
      <View ref={rootRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />

      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <AnimatedPath animatedProps={scrimProps} fill={SCRIM} fillRule="evenodd" />
      </Svg>

      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: theme.primary }, ringStyle]}
      />

      <View
        onLayout={onCardLayout}
        style={[
          styles.card,
          {
            top: cardTop,
            left: cardLeft,
            width: cardWidth,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: ready ? 1 : 0,
          },
        ]}>
        {hole ? (
          <View
            pointerEvents="none"
            style={[
              styles.caret,
              { left: caretX, backgroundColor: theme.backgroundElement, borderColor: theme.border },
              below ? styles.caretTop : styles.caretBottom,
            ]}
          />
        ) : null}

        <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.cardBody}>
          <ThemedText themeColor="brandInk" style={[Type.label, styles.counter]}>
            {`${index + 1} OF ${TOUR_STEPS.length}`}
          </ThemedText>
          <ThemedText accessibilityRole="header" style={Type.headline}>
            {step.title}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={Type.body}>
            {step.body}
          </ThemedText>
        </Animated.View>

        <View style={styles.actions}>
          {last ? (
            <View style={styles.flex} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip the tour"
              onPress={finish}
              hitSlop={10}
              style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.semi]}>
                Skip
              </ThemedText>
            </Pressable>
          )}
          {index > 0 ? (
            <Button title="Back" variant="ghost" onPress={back} style={styles.button} />
          ) : null}
          <Button title={last ? 'Done' : 'Next'} onPress={next} style={styles.button} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Over the tab bar and the Add disc, which carry Android elevation of their
  // own; without a higher one here they would draw on top of the scrim.
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 },
  ring: { position: 'absolute', borderWidth: 2 },
  card: {
    position: 'absolute',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardBody: { gap: Spacing.one },
  counter: { marginBottom: Spacing.half },
  // A small square turned 45°, half hidden behind the card: the point that
  // says which thing the card is about.
  caret: {
    position: 'absolute',
    width: CARET,
    height: CARET,
    transform: [{ rotate: '45deg' }],
    borderWidth: StyleSheet.hairlineWidth,
  },
  caretTop: { top: -CARET / 2, borderRightWidth: 0, borderBottomWidth: 0 },
  caretBottom: { bottom: -CARET / 2, borderLeftWidth: 0, borderTopWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  skip: { flex: 1, paddingVertical: Spacing.two },
  semi: { fontWeight: '600' },
  button: { minHeight: 42, paddingHorizontal: Spacing.four - 4 },
});
