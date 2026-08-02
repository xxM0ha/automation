import { Pressable, View, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { colors, spacing, radius } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'outline';

type Props = Omit<PressableProps, 'style'> & {
  label: string;
  icon?: IconName;
  variant?: Variant;
  fullWidth?: boolean;
  style?: ViewStyle;
};

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  secondary: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  danger: { bg: colors.error, fg: colors.onError },
  outline: { bg: 'transparent', fg: colors.onSurface, border: colors.outlineVariant },
};

export function Button({ label, icon, variant = 'primary', fullWidth, style, ...rest }: Props) {
  const v = VARIANTS[variant];
  const { disabled } = rest;
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: v.bg,
          borderWidth: v.border ? StyleSheet.hairlineWidth : 0,
          borderColor: v.border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={v.fg} />}
      <Text variant="labelLg" color={v.fg}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    borderRadius: radius.lg,
  },
});
