import { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';

export interface FloatingItem {
  id: string;
  label: string;
  backgroundColor: string;
  textColor: string;
}

interface Props {
  item: FloatingItem;
  index: number;
  onDone: (id: string) => void;
}

export function FloatingCurrencyNotification({ item, index, onDone }: Props) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -180,
        duration: 2500,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(1700),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      onDone(item.id);
    });
  }, [item.id, onDone, translateY, opacity]);

  const bottomOffset = 80 + index * 64;

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: bottomOffset, transform: [{ translateY }], opacity },
      ]}
      accessibilityLabel={item.label}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.label, { color: item.textColor, backgroundColor: item.backgroundColor }]}>
        {item.label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    pointerEvents: 'none',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 9999,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
