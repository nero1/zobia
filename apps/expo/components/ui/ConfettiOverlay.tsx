import { useCallback, useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#06b6d4'];

interface Particle {
  x: number;
  startY: number;
  color: string;
  size: number;
  translateY: Animated.Value;
  translateX: Animated.Value;
  opacity: Animated.Value;
  rotate: Animated.Value;
}

interface Props {
  onDone: () => void;
}

export function ConfettiOverlay({ onDone }: Props) {
  // Use live window dimensions so the overlay works correctly after orientation
  // changes and on first render when Dimensions.get('window') may not yet reflect
  // the real screen size (BUG-017 fix).
  const { width, height } = useWindowDimensions();

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  const stableOnDone = useCallback(() => onDoneRef.current(), []);

  const particles = useRef<Particle[]>(
    Array.from({ length: 40 }, (_, i) => ({
      x: Math.random() * width,
      startY: -20,
      color: COLORS[i % COLORS.length],
      size: 7 + Math.random() * 7,
      translateY: new Animated.Value(0),
      translateX: new Animated.Value(0),
      opacity: new Animated.Value(1),
      rotate: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const animations = particles.map((p) => {
      const delay = Math.random() * 400;
      const duration = 1800 + Math.random() * 1200;
      const xDrift = (Math.random() - 0.5) * 120;

      return Animated.parallel([
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.translateY, {
            toValue: height + 100,
            duration,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.translateX, {
            toValue: xDrift,
            duration,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(delay + duration * 0.6),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: duration * 0.4,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.rotate, {
            toValue: 10,
            duration,
            useNativeDriver: true,
          }),
        ]),
      ]);
    });

    const master = Animated.parallel(animations);
    master.start(() => stableOnDone());

    return () => master.stop();
  }, [stableOnDone, particles, height]);

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((p, i) => {
        const rotateDeg = p.rotate.interpolate({
          inputRange: [0, 10],
          outputRange: ['0deg', '720deg'],
        });
        return (
          <Animated.View
            key={i}
            style={[
              {
                position: 'absolute',
                left: p.x,
                top: p.startY,
                width: p.size,
                height: p.size / 2,
                backgroundColor: p.color,
                borderRadius: 2,
              },
              {
                transform: [
                  { translateY: p.translateY },
                  { translateX: p.translateX },
                  { rotate: rotateDeg },
                ],
                opacity: p.opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
});
