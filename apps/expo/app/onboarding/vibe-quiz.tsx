/**
 * Zobia Social — Onboarding Step 2: Vibe Quiz.
 *
 * 4 questions with 4 answer options each.  The selected answers are passed
 * forward to the Welcome Drop screen via route params so the backend can
 * compute an initial "vibe tag" for the user.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuizQuestion {
  key: string;
  questionText: string;
  options: { label: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Quiz data
// ---------------------------------------------------------------------------

function useQuizQuestions(): QuizQuestion[] {
  const currency = useCurrency();
  return [
    {
      // PRD §4: seeds Room recommendations
      key: 'q1',
      questionText: 'What do you do most?',
      options: [
        { label: 'Argue 🗣️', value: 'argue' },
        { label: 'Gist 😂', value: 'gist' },
        { label: 'Learn 📚', value: 'learn' },
        { label: 'Flex 💪', value: 'flex' },
      ],
    },
    {
      // PRD §4: surfaces Guild discovery vs solo track emphasis
      key: 'q2',
      questionText: 'Are you a lone wolf or a crew person?',
      options: [
        { label: 'Total lone wolf 🐺', value: 'lone_wolf' },
        { label: 'Mostly solo', value: 'mostly_solo' },
        { label: 'Mostly with my crew', value: 'mostly_crew' },
        { label: 'Nothing without my crew 🤝', value: 'crew' },
      ],
    },
    {
      // PRD §4: adjusts onboarding tone
      key: 'q3',
      questionText: 'What brings you here?',
      options: [
        { label: 'Connect with friends 👥', value: 'friends' },
        { label: `Stack ${currency.softPlural.toLowerCase()} 💰`, value: 'money' },
        { label: 'Just vibing ✌️', value: 'vibing' },
        { label: 'All of it 🔥', value: 'all_of_it' },
      ],
    },
    {
      // PRD §4: seeds social and competitive graph by city vibe
      key: 'q4',
      questionText: "Pick your city's vibe:",
      options: [
        { label: 'Competitive — always on top 🏆', value: 'competitive' },
        { label: 'Social — everyone knows everyone 🤗', value: 'social' },
        { label: 'Creative — arts, music, culture 🎨', value: 'creative' },
        { label: 'Chill — low-key and unbothered 😌', value: 'chill' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * VibeQuiz — step 2 of onboarding.
 *
 * Receives `username`, `emoji`, and `city` from step 1 via route params
 * and passes all data forward to the welcome-drop screen.
 */
export default function VibeQuiz() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  // M-6: birthYear/Month/Day are no longer in params — they are persisted to
  // MMKV in index.tsx and read directly in welcome-drop.tsx.
  const params = useLocalSearchParams<{
    username: string;
    emoji: string;
    city: string;
  }>();

  const questions = useQuizQuestions();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  const allAnswered = questions.every((q) => answers[q.key] !== undefined);

  function selectAnswer(questionKey: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionKey]: value }));
  }

  function handleNext() {
    router.push({
      pathname: '/onboarding/welcome-drop',
      params: {
        ...params,
        vibeAnswers: JSON.stringify(answers),
      },
    });
  }

  // Progress: number of answered questions out of 4.
  const progress = Object.keys(answers).length / questions.length;

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.stepBadge, { color: colors.brand.blue }]}>Step 2 of 3</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {t('onboarding.step2Title')}
        </Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {t('onboarding.step2Subtitle')}
        </Text>

        {/* Progress bar */}
        <View style={[styles.progressTrack, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[200] }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress * 100}%`,
                backgroundColor: colors.brand.blue,
              },
            ]}
          />
        </View>
      </View>

      {/* Questions */}
      {questions.map((q) => (
        <View key={q.key} style={styles.question}>
          <Text style={[styles.questionText, { color: textColor }]}>
            {q.questionText}
          </Text>
          <View style={styles.options}>
            {q.options.map((opt) => {
              const isSelected = answers[q.key] === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => selectAnswer(q.key, opt.value)}
                  style={[
                    styles.option,
                    {
                      borderColor: isSelected
                        ? colors.brand.blue
                        : isDark
                        ? colors.neutral[700]
                        : colors.neutral[300],
                      backgroundColor: isSelected
                        ? colors.brand.blue + '15'
                        : isDark
                        ? colors.neutral[800]
                        : colors.neutral[0],
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={opt.label}
                >
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor: isSelected ? colors.brand.blue : isDark ? colors.neutral[600] : colors.neutral[400],
                      },
                    ]}
                  >
                    {isSelected && (
                      <View style={[styles.radioInner, { backgroundColor: colors.brand.blue }]} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color: isSelected
                          ? colors.brand.blue
                          : textColor,
                        fontWeight: isSelected ? '600' : '400',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {/* CTA */}
      <Button
        label={t('common.next')}
        size="lg"
        onPress={handleNext}
        disabled={!allAnswered}
        style={styles.cta}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 28,
  },
  header: {
    gap: 8,
  },
  stepBadge: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  question: {
    gap: 12,
  },
  questionText: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
  },
  options: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    minHeight: 44,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionLabel: {
    fontSize: 15,
    flex: 1,
  },
  cta: {
    marginTop: 8,
  },
});
