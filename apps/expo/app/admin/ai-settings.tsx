/**
 * app/admin/ai-settings.tsx
 *
 * AI Settings admin screen (mobile).
 * Shows connection status for DeepSeek and Gemini, allows testing connections
 * and overriding API keys at runtime.
 */

import React, { useState, useCallback } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  RefreshControl,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CircuitInfo {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  openedAt: number | null;
}

interface ProviderInfo {
  keySource: 'env' | 'override';
  keyMasked: string | null;
  circuit?: CircuitInfo;
}

interface AiSettingsData {
  deepseek: ProviderInfo;
  gemini: ProviderInfo;
}

interface TestResult {
  success: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchAiSettings(): Promise<AiSettingsData> {
  const { data } = await apiClient.get('/admin/ai-settings');
  return data.data;
}

async function saveAiKey(provider: 'deepseek' | 'gemini', apiKey: string): Promise<void> {
  await apiClient.put('/admin/ai-settings', { provider, apiKey });
}

async function testAiConnection(
  provider: 'deepseek' | 'gemini',
  apiKey?: string
): Promise<TestResult> {
  const { data } = await apiClient.post('/admin/ai-settings/test', {
    provider,
    ...(apiKey ? { apiKey } : {}),
  });
  return data.data as TestResult;
}

// ---------------------------------------------------------------------------
// CircuitChip
// ---------------------------------------------------------------------------

function CircuitChip({ circuit }: { circuit: CircuitInfo }) {
  const chipColors = {
    closed: { bg: `${colors.semantic.success}18`, text: colors.semantic.success },
    'half-open': { bg: `${colors.semantic.warning}18`, text: colors.semantic.warning },
    open: { bg: `${colors.semantic.error}18`, text: colors.semantic.error },
  };
  const style = chipColors[circuit.status];
  const label =
    circuit.status === 'closed'
      ? 'Circuit Closed'
      : circuit.status === 'half-open'
      ? 'Circuit Half-Open'
      : 'Circuit Open';

  return (
    <View style={[styles.chip, { backgroundColor: style.bg }]}>
      <Text style={[styles.chipText, { color: style.text }]}>
        {label}
        {circuit.failures > 0 ? ` · ${circuit.failures} failure${circuit.failures !== 1 ? 's' : ''}` : ''}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProviderCard
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  title: string;
  provider: 'deepseek' | 'gemini';
  info: ProviderInfo | undefined;
  onSave: (provider: 'deepseek' | 'gemini', key: string) => void;
  onClear: (provider: 'deepseek' | 'gemini') => void;
  onTest: (provider: 'deepseek' | 'gemini', draft: string) => void;
  saving: boolean;
  testing: boolean;
  testResult: TestResult | null;
}

function ProviderCard({
  title,
  provider,
  info,
  onSave,
  onClear,
  onTest,
  saving,
  testing,
  testResult,
}: ProviderCardProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [keyDraft, setKeyDraft] = useState('');

  const keySourceLabel =
    info?.keySource === 'override'
      ? `Override active${info.keyMasked ? ` (ends ${info.keyMasked})` : ''}`
      : 'Using environment variable';

  return (
    <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      <Text style={[styles.cardTitle, { color: themeColors.text }]}>{title}</Text>

      {info?.circuit && <CircuitChip circuit={info.circuit} />}

      <Text style={[styles.keySourceText, { color: themeColors.textMuted }]}>
        {info ? keySourceLabel : '—'}
      </Text>

      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
            color: themeColors.text,
          },
        ]}
        placeholder="Override API key (blank = use env var)"
        placeholderTextColor={themeColors.textMuted}
        secureTextEntry
        value={keyDraft}
        onChangeText={setKeyDraft}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.buttonRow}>
        <Button
          label={saving ? 'Saving…' : 'Save Key'}
          variant="primary"
          onPress={() => onSave(provider, keyDraft)}
          loading={saving}
          style={styles.btn}
        />
        {info?.keySource === 'override' && (
          <Button
            label="Clear"
            variant="ghost"
            onPress={() => onClear(provider)}
            loading={saving}
            style={styles.btn}
          />
        )}
        <Button
          label={testing ? 'Testing…' : 'Test'}
          variant="ghost"
          onPress={() => onTest(provider, keyDraft)}
          loading={testing}
          style={styles.btn}
        />
      </View>

      {testResult && (
        <View
          style={[
            styles.testResultBox,
            {
              backgroundColor: testResult.success
                ? isDark ? '#0F2E2B' : '#F0FDF4'
                : isDark ? '#2E1010' : '#FFF1F2',
            },
          ]}
        >
          <Text
            style={[
              styles.testResultText,
              { color: testResult.success ? (isDark ? '#6EE7B7' : '#047857') : (isDark ? '#FCA5A5' : '#B91C1C') },
            ]}
          >
            {testResult.success
              ? `Connected — ${testResult.latencyMs}ms${testResult.model ? ` (${testResult.model})` : ''}`
              : `Failed: ${testResult.error ?? 'Unknown error'}`}
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AdminAiSettingsScreen() {
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();

  const [deepseekSaving, setDeepseekSaving] = useState(false);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [deepseekTesting, setDeepseekTesting] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [deepseekTestResult, setDeepseekTestResult] = useState<TestResult | null>(null);
  const [geminiTestResult, setGeminiTestResult] = useState<TestResult | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'ai-settings'],
    queryFn: fetchAiSettings,
  });

  const handleSave = useCallback(async (provider: 'deepseek' | 'gemini', key: string) => {
    const setSaving = provider === 'deepseek' ? setDeepseekSaving : setGeminiSaving;
    setSaving(true);
    try {
      await saveAiKey(provider, key);
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-settings'] });
    } catch {
      Alert.alert('Error', 'Failed to save API key. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [queryClient]);

  const handleClear = useCallback(async (provider: 'deepseek' | 'gemini') => {
    await handleSave(provider, '');
  }, [handleSave]);

  const handleTest = useCallback(async (provider: 'deepseek' | 'gemini', draft: string) => {
    const setTesting = provider === 'deepseek' ? setDeepseekTesting : setGeminiTesting;
    const setResult = provider === 'deepseek' ? setDeepseekTestResult : setGeminiTestResult;
    setTesting(true);
    setResult(null);
    try {
      const result = await testAiConnection(provider, draft || undefined);
      setResult(result);
    } catch {
      setResult({ success: false, error: 'Request failed' });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <Screen scrollable={false} contentStyle={styles.container}>
      <Text style={[styles.heading, { color: themeColors.text }]}>AI Settings</Text>
      <Text style={[styles.subheading, { color: themeColors.textMuted }]}>
        Manage API keys and connection status for AI providers.
      </Text>

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        contentContainerStyle={styles.scrollContent}
      >
        <ProviderCard
          title="DeepSeek (Primary)"
          provider="deepseek"
          info={data?.deepseek}
          onSave={handleSave}
          onClear={handleClear}
          onTest={handleTest}
          saving={deepseekSaving}
          testing={deepseekTesting}
          testResult={deepseekTestResult}
        />
        <ProviderCard
          title="Gemini (Fallback)"
          provider="gemini"
          info={data?.gemini}
          onSave={handleSave}
          onClear={handleClear}
          onTest={handleTest}
          saving={geminiSaving}
          testing={geminiTesting}
          testResult={geminiTestResult}
        />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 16 },
  scroll: { flex: 1 },
  scrollContent: { gap: 16, paddingBottom: 32 },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },

  chip: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 12, fontWeight: '600' },

  keySourceText: { fontSize: 13 },

  input: {
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },

  buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { minWidth: 80 },

  testResultBox: {
    borderRadius: 8,
    padding: 10,
  },
  testResultText: { fontSize: 13, fontWeight: '500' },
});
