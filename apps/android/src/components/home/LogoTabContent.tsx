/**
 * apps/android/src/components/home/LogoTabContent.tsx
 *
 * Content shown on the Home Dashboard's default logo tab — mirrors
 * apps/web/components/home/LogoTabContent.tsx: Zobian of the Month, Quests
 * (Daily Quest Deck + New Member Quest), Challenges (Nemesis), and the
 * Presence/Online Friends tabs, followed by Leaderboard Position and Guild
 * Discovery.
 *
 * Web's LogoTabContent also renders <CreatorSpotlight /> at the end; no
 * Android equivalent of that component exists yet (nothing under
 * components/discovery/ in this app), so it's omitted here as a documented
 * simplification rather than porting a whole new discovery feature as part
 * of this Home Dashboard mirror.
 */

import { useTranslation } from 'react-i18next';
import { ZobianOfMonthCard } from './ZobianOfMonthCard';
import { DailyQuestDeck } from './DailyQuestDeck';
import { NewMemberQuestCard } from './NewMemberQuestCard';
import { NemesisCard } from './NemesisCard';
import { PresenceTabs } from './PresenceTabs';
import { LeaderboardCard } from './LeaderboardCard';
import { GuildDiscoveryPanel } from './GuildDiscoveryPanel';

export function LogoTabContent() {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <ZobianOfMonthCard />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{t('home.sections.quests')}</h2>
        <DailyQuestDeck />
        <NewMemberQuestCard />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{t('home.sections.challenges')}</h2>
        <NemesisCard />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{t('home.sections.presence')}</h2>
        <PresenceTabs />
      </section>

      <LeaderboardCard />
      <GuildDiscoveryPanel />
    </div>
  );
}
