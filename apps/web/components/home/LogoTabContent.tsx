"use client";

/**
 * components/home/LogoTabContent.tsx
 *
 * Content shown on the Home Dashboard's default logo tab: Zobian of the
 * Month, Quests (Daily Quest Deck + New Member Quest), Challenges
 * (Nemesis), and the Presence/Online Friends tabs, followed by Leaderboard
 * Position and Guild Discovery. Site news (AnnouncementBanner/Modal) is
 * already rendered globally in app/(app)/layout.tsx, so it isn't repeated
 * here — see the Home Dashboard task report for details.
 */

import { useTranslation } from "react-i18next";
import { ZobianOfMonthCard } from "./ZobianOfMonthCard";
import { DailyQuestDeck } from "./DailyQuestDeck";
import { NewMemberQuestCard } from "./NewMemberQuestCard";
import { NemesisCard } from "./NemesisCard";
import { PresenceTabs } from "./PresenceTabs";
import { LeaderboardCard } from "./LeaderboardCard";
import { GuildDiscoveryPanel } from "./GuildDiscoveryPanel";
import { CreatorSpotlight } from "@/components/discovery/CreatorSpotlight";

export function LogoTabContent() {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <ZobianOfMonthCard />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t("home.sections.quests")}</h2>
        <DailyQuestDeck />
        <NewMemberQuestCard />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t("home.sections.challenges")}</h2>
        <NemesisCard />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t("home.sections.presence")}</h2>
        <PresenceTabs />
      </section>

      <LeaderboardCard />
      <GuildDiscoveryPanel />
      <CreatorSpotlight />
    </div>
  );
}
