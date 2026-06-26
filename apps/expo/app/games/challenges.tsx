/**
 * app/games/challenges.tsx
 *
 * Challenge inbox + creation (mobile). Lists sent/received challenges with
 * accept / decline / cancel actions, a form to challenge a user, and a
 * "Play round" action that opens the game bound to the challenge.
 */

import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/lib/auth/hooks';
import { apiClient } from '@/lib/api/client';

interface GameSummary { slug: string; name: string; }
interface Challenge {
  id: string; gameSlug: string; gameName: string;
  challengerId: string; challengerUsername: string;
  opponentId: string; opponentUsername: string;
  status: string; rounds: number; wagerCredits: number; winnerId: string | null;
}

export default function ChallengesScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = user?.id ?? null;

  const [form, setForm] = useState({ gameSlug: '', opponentUsername: '', rounds: 1, wagerCredits: 0 });
  const [msg, setMsg] = useState<string | null>(null);

  const gamesQ = useQuery({
    queryKey: ['games', 'list'],
    queryFn: async () => {
      const res = await apiClient.get('/games');
      const list = (res.data.data.games ?? []) as GameSummary[];
      if (list[0] && !form.gameSlug) setForm((f) => ({ ...f, gameSlug: list[0].slug }));
      return list;
    },
  });

  const challengesQ = useQuery({
    queryKey: ['games', 'challenges'],
    queryFn: async () => {
      const res = await apiClient.get('/games/challenges');
      return (res.data.data.challenges ?? []) as Challenge[];
    },
  });

  const actMut = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) =>
      apiClient.post(`/games/challenges/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['games', 'challenges'] }),
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      setMsg(e.response?.data?.error?.message ?? 'Action failed.'),
  });

  const createMut = useMutation({
    mutationFn: async () => apiClient.post('/games/challenges', form),
    onSuccess: () => { setMsg(t('games.challengeSent', 'Challenge sent!')); qc.invalidateQueries({ queryKey: ['games', 'challenges'] }); },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      setMsg(e.response?.data?.error?.message ?? 'Could not create challenge.'),
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('games.challenges', 'Challenges') }} />
      <FlatList
        ListHeaderComponent={
          <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.h2, { color: colors.text }]}>{t('games.newChallenge', 'New challenge')}</Text>
            <View style={styles.gameRow}>
              {(gamesQ.data ?? []).map((g: GameSummary) => (
                <Pressable key={g.slug} onPress={() => setForm({ ...form, gameSlug: g.slug })}
                  style={[styles.chip, { backgroundColor: form.gameSlug === g.slug ? colors.primary : colors.background }]}>
                  <Text style={{ color: form.gameSlug === g.slug ? '#fff' : colors.text, fontSize: 12 }}>{g.name}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder={t('games.opponentUsername', 'Opponent username')}
              placeholderTextColor={colors.textMuted}
              value={form.opponentUsername}
              onChangeText={(v) => setForm({ ...form, opponentUsername: v })}
              autoCapitalize="none"
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
            <View style={styles.gameRow}>
              {[1, 3].map((r) => (
                <Pressable key={r} onPress={() => setForm({ ...form, rounds: r })}
                  style={[styles.chip, { backgroundColor: form.rounds === r ? colors.primary : colors.background }]}>
                  <Text style={{ color: form.rounds === r ? '#fff' : colors.text, fontSize: 12 }}>
                    {r === 1 ? t('games.bestOf1', 'Best of 1') : t('games.bestOf3', 'Best of 3')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder={t('games.wager', 'wager') + ' (credits)'}
              placeholderTextColor={colors.textMuted}
              value={String(form.wagerCredits || '')}
              onChangeText={(v) => setForm({ ...form, wagerCredits: Number(v) || 0 })}
              keyboardType="number-pad"
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
            <Pressable onPress={() => createMut.mutate()} style={[styles.cta, { backgroundColor: colors.primary }]}>
              <Text style={styles.ctaText}>{t('games.sendChallenge', 'Send challenge')}</Text>
            </Pressable>
            {msg ? <Text style={{ color: '#f59e0b', marginTop: 6 }}>{msg}</Text> : null}
          </View>
        }
        data={challengesQ.data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, padding: 16 }}>{t('games.noChallenges', 'No challenges yet.')}</Text>}
        renderItem={({ item: c }) => {
          const incoming = c.opponentId === me;
          return (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{c.gameName}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {incoming ? `${t('games.from', 'from')} @${c.challengerUsername}` : `${t('games.to', 'to')} @${c.opponentUsername}`}
                {' · '}{c.rounds === 1 ? t('games.bestOf1', 'Best of 1') : t('games.bestOf3', 'Best of 3')}
                {c.wagerCredits > 0 ? ` · ${c.wagerCredits} ${t('games.credits', 'credits')}` : ''}
                {' · '}{t(`games.status.${c.status}`, c.status) as string}
              </Text>
              <View style={styles.actions}>
                {incoming && c.status === 'pending' && (
                  <>
                    <Pressable onPress={() => actMut.mutate({ id: c.id, action: 'accept' })} style={[styles.smallBtn, { backgroundColor: '#10b981' }]}><Text style={styles.smallBtnText}>{t('games.accept', 'Accept')}</Text></Pressable>
                    <Pressable onPress={() => actMut.mutate({ id: c.id, action: 'decline' })} style={[styles.smallBtn, { backgroundColor: colors.background }]}><Text style={[styles.smallBtnText, { color: colors.text }]}>{t('games.decline', 'Decline')}</Text></Pressable>
                  </>
                )}
                {!incoming && (c.status === 'pending' || c.status === 'active') && (
                  <Pressable onPress={() => actMut.mutate({ id: c.id, action: 'cancel' })} style={[styles.smallBtn, { backgroundColor: colors.background }]}><Text style={[styles.smallBtnText, { color: colors.text }]}>{t('games.cancel', 'Cancel')}</Text></Pressable>
                )}
                {c.status === 'active' && (
                  <Pressable onPress={() => router.push({ pathname: '/games/play', params: { slug: c.gameSlug, challengeId: c.id } })} style={[styles.smallBtn, { backgroundColor: colors.primary }]}><Text style={styles.smallBtnText}>{t('games.playRound', 'Play your round')}</Text></Pressable>
                )}
                {c.status === 'completed' && (
                  <Text style={{ color: '#10b981', fontSize: 12, fontWeight: '700' }}>
                    {c.winnerId === me ? t('games.youWon', 'You won! 🏆') : c.winnerId ? t('games.youLost', 'You lost') : t('games.draw', 'Draw')}
                  </Text>
                )}
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, gap: 10 },
  h2: { fontWeight: '700', fontSize: 16 },
  gameRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  cta: { borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  cardTitle: { fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
