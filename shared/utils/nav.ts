/**
 * shared/utils/nav.ts
 *
 * Path-segment-aware "is this nav item active?" check shared by the web
 * Navbar/Sidebar and the Capacitor TopBar. A plain `pathname.startsWith(href)`
 * breaks for short hrefs: `/h` (Portals) matches `/home`. Matching on a
 * segment boundary fixes that for every item.
 */
export function isNavPathActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Consistent section order for desktop, mobile web/PWA and Capacitor menus. */
export function groupNavigation<T extends { href: string }>(items: readonly T[]) {
  const groups = [
    { key: 'nav.groups.discover', label: 'Discover', roots: ['/home','/search','/h','/moments','/tweets','/blogs','/t','/forum','/answers','/wiki','/polls','/quizzes','/classroom'] },
    { key: 'nav.groups.connect', label: 'Connect', roots: ['/rooms','/guilds','/friends','/messages','/gifts','/events','/announcements','/council'] },
    { key: 'nav.groups.progress', label: 'Play and progress', roots: ['/quests','/games','/leaderboards','/elder','/referrals'] },
    { key: 'nav.groups.account', label: 'Your account', roots: [] as string[] },
  ];
  return groups.map((group, index) => ({ ...group, items: items.filter((item) => {
    const match = groups.findIndex((candidate) => candidate.roots.some((root) => item.href === root || item.href.startsWith(`${root}/`)));
    return (match < 0 ? groups.length - 1 : match) === index;
  }) })).filter((group) => group.items.length);
}

/** Common admin grouping for web's /gate44 and Capacitor's /admin routes. */
export function groupAdminNavigation<T extends {href:string}>(items:readonly T[]){
 const categories=['Overview','Settings and configuration','Accounts and money','Safety and support','People and communication','Content and rewards','Operations'];
 const category=(href:string)=>/config|settings|feature-flags|footer-scripts/.test(href)?1:/financial|payout|refund|payment|business|kyc/.test(href)?2:/moderation|watch56|support|help-center|tales/.test(href)?3:/monitoring|log|automated|ai-monitoring|data-management/.test(href)?6:/users|announcements|messages|alerts/.test(href)?4:/^\/(gate44|admin)$/.test(href)?0:5;
 return categories.map((label,index)=>({key:`admin.groups.${index}`,label,items:items.filter(item=>category(item.href)===index)})).filter(group=>group.items.length);
}
