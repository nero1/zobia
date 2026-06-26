/**
 * lib/i18n/pidgin.ts
 *
 * Pidgin autocorrect/suggestion dictionary for Nigerian English locale.
 * Activated when the user's locale is set to 'ng' (Nigeria) or 'en-NG'.
 * Used to surface common Nigerian Pidgin phrases as autocomplete suggestions.
 */

/** Map from English word/phrase → common Nigerian Pidgin equivalents */
export const PIDGIN_SUGGESTIONS: Record<string, string[]> = {
  // Greetings
  'hello':       ['How far', 'Wetin dey', 'How body'],
  'hi':          ['Omo', 'Abeg'],
  'how are you': ['How far', 'You dey', 'Body dey'],
  'good morning':['E don bright', 'Morning O'],
  'good night':  ['Night O', 'Sleep well O'],

  // Common expressions
  'yes':         ['E be that', 'Na so'],
  'no':          ['E no be so', 'Abeg no'],
  'okay':        ['Oya', 'No wahala', 'E don do'],
  'understand':  ['I hear', 'I don see'],
  'really':      ['Abi', 'Na lie', 'Serious'],
  'wow':         ['Omo', 'Chai', 'Haba'],
  'no problem':  ['No wahala', 'E go be'],
  'thank you':   ['E don do', 'Thank you O'],
  'sorry':       ['Sorry O', 'E pain me'],
  'hurry up':    ['Sharp sharp', 'Oya now'],
  'friend':      ['Oga', 'Bros', 'Sista'],
  'money':       ['Owo', 'Ego', 'Kudi'],
  'eat':         ['Chop'],
  'come':        ['Comot', 'Come now'],
  'go':          ['Comot', 'Waka'],
  'talk':        ['Yarn', 'Speak'],
  'know':        ['Sabi'],
  'want':        ['Wan'],
  'big':         ['Fat', 'Kpakam'],
  'person':      ['Person', 'Mumu'],
  'correct':     ['Sharp', 'Correct'],
  'stupid':      ['Mumu', 'Olodo'],
  'love':        ['Heart'],
  'fight':       ['Scatter'],
};

/**
 * Get Pidgin autocomplete suggestions for a given input string.
 * Returns up to 3 suggestions.
 */
export function getPidginSuggestions(input: string, locale: string): string[] {
  if (!locale.startsWith('en-NG') && locale !== 'ng' && locale !== 'pidgin') return [];

  const lower = input.toLowerCase().trim();
  if (lower.length < 2) return [];

  const suggestions: string[] = [];

  for (const [key, values] of Object.entries(PIDGIN_SUGGESTIONS)) {
    if (key.startsWith(lower)) {
      suggestions.push(...values);
    }
    if (suggestions.length >= 3) break;
  }

  return suggestions.slice(0, 3);
}

/**
 * Check if the platform should show Pidgin suggestions for this locale.
 */
export function isPidginLocale(locale: string): boolean {
  return locale.startsWith('en-NG') || locale === 'ng' || locale === 'pidgin';
}
