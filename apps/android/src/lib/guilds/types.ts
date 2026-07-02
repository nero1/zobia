/**
 * apps/android/src/lib/guilds/types.ts
 *
 * Shared types for the Guild routes (guild.tsx, guilds/index.tsx,
 * guilds/$guildId.tsx). Mirrors the fixed GET /api/guilds/:guildId and
 * GET /api/guilds/discovery response shapes — see the guild.tsx header
 * comment and apps/web/app/api/guilds/[guildId]/route.ts for the contract
 * fix this depends on.
 */

export type GuildMemberRole = 'captain' | 'veteran' | 'recruiter' | 'member';

export interface GuildSummary {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  tier: string;
  memberCount: number;
  guildXp: number;
  warWins: number;
  isRecruiting: boolean;
  sameCity: boolean;
}

export interface GuildMember {
  userId: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string;
  role: GuildMemberRole;
  contributionScore: number;
  joinedAt: string;
}

export interface WarRecord {
  id: string;
  opponentName: string;
  opponentCrestEmoji: string;
  result: 'win' | 'loss' | 'draw';
  myScore: number;
  opponentScore: number;
  endedAt: string;
}

export interface ActiveWar {
  id: string;
  opponentName: string;
  opponentCrestEmoji: string;
  myScore: number;
  opponentScore: number;
  endsAt: string;
  finalHour: boolean;
}

export interface AllianceRecord {
  id: string;
  allianceName: string;
  role: 'initiator' | 'ally';
  joinedAt: string;
  leftAt: string | null;
}

export interface GuildQuest {
  id: string;
  title: string;
  description: string;
  progressPct: number;
  rewardXp: number;
  endsAt: string;
}

export interface GuildDetail {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  tier: string;
  guildXp: number;
  tierXpRequired: number;
  memberCount: number;
  maxMembers: number;
  warWins: number;
  warLosses: number;
  treasuryBalance: number | null;
  isOpenToJoin: boolean;
  isMember: boolean;
  isCaptain: boolean;
  activeWar: ActiveWar | null;
  members: GuildMember[];
  warHistory: WarRecord[];
  allianceHistory: AllianceRecord[];
  activeQuests: GuildQuest[];
  recruitmentMode: 'open' | 'approval' | 'invite_only';
  createdAt: string;
}
