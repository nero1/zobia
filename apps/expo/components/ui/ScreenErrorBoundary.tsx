import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme/colors';

interface Props {
  error: Error;
  retry: () => void;
}

export function ErrorBoundary({ error, retry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message} numberOfLines={4}>
        {error.message || 'An unexpected error occurred.'}
      </Text>
      <Pressable
        style={styles.button}
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[800],
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: colors.neutral[500],
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: colors.neutral[0],
    fontSize: 15,
    fontWeight: '700',
  },
});
