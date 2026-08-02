import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { typography, type TypographyToken, colors } from '../theme';

type Props = RNTextProps & {
  variant?: TypographyToken;
  color?: string;
};

export function Text({ variant = 'bodyMd', color = colors.onSurface, style, ...rest }: Props) {
  return <RNText {...rest} style={[typography[variant], { color, writingDirection: 'rtl' }, style]} />;
}
