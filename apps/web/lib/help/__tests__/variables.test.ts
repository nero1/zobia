jest.mock('@/lib/manifest', () => ({
  loadManifest: jest.fn().mockResolvedValue({ currency: { softNamePlural: 'Tokens', softNameSingular: 'Token' }, games: { challengeExpiryHours: 72 } }),
  getManifestValue: jest.fn().mockImplementation(async (key: string) => key === 'help_ai_weekly_limit_free' ? '35' : null),
}));
import { renderHelpText } from '../variables';
import { getManifestValue } from '@/lib/manifest';

describe('public help variables', () => {
  it('uses current labels and settings rather than baked-in guide prices', async () => {
    expect(await renderHelpText('{{currency.softPlural}}: {{help.aiFreeWeeklyLimit}} questions, {{challenges.expiryHours}} hours')).toBe('Tokens: 35 questions, 72 hours');
  });
  it('never reads an arbitrary manifest key from a document', async () => {
    (getManifestValue as jest.Mock).mockClear();
    expect(await renderHelpText('{{PAYSTACK_SECRET_KEY}}')).toBe('{{PAYSTACK_SECRET_KEY}}');
    expect(getManifestValue).not.toHaveBeenCalled();
  });
});
