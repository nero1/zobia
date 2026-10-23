/** Safe destinations shared by all quest lists; unknown admin actions stay on Quests. */
export function questActionPath(action: string): string {
  const routes: Record<string, string> = {
    messages: '/messages', room_join: '/rooms', gift: '/gifts', login_streak: '/home',
    guild_quest: '/guilds', xp_meta: '/home', game_play: '/games', blog_publish: '/blogs',
    blog_comment: '/blogs', wiki_edit: '/wiki', poll_vote: '/polls', poll_create: '/polls',
    quiz_complete: '/quizzes', quiz_perfect: '/quizzes', forum_reply: '/forum',
    forum_create_thread: '/forum', market_purchase: '/market',
    challenge_send: '/games/challenges', challenge_accept: '/games/challenges', challenge_win: '/games/challenges',
  };
  return routes[action] ?? '/quests';
}
