import { StyleSheet, View, type ViewProps } from 'react-native';

import { Elevation, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = ViewProps & {
  /** 'raised' lifts further off the page — for the one thing that matters most
   *  on a screen, never for a list of equals. */
  variant?: 'flat' | 'card' | 'raised';
  padded?: boolean;
};

export function Card({ variant = 'card', padded = true, style, ...rest }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.base,
        padded && styles.padded,
        {
          backgroundColor: variant === 'flat' ? theme.backgroundSunken : theme.backgroundElement,
          borderColor: theme.border,
        },
        variant === 'card' && Elevation.card,
        variant === 'raised' && Elevation.raised,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth },
  padded: { padding: Spacing.four },
});
