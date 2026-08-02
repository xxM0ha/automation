import { useEffect, useRef } from 'react';
import { Animated, Easing, View, StyleSheet } from 'react-native';
import { colors } from '../theme';

type Props = {
  size?: number;
  color?: string;
};

// Replicates Tailwind's animate-ping: solid dot + an expanding halo that fades.
export function LivePing({ size = 12, color = colors.primary }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 2.2, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.75, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);

  const dim = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.wrap, dim]}>
      <Animated.View
        style={[
          styles.halo,
          dim,
          { backgroundColor: color, opacity, transform: [{ scale }] },
        ]}
      />
      <View style={[styles.solid, dim, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
  },
  solid: {
    position: 'relative',
  },
});
