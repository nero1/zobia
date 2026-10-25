import { authFailureLogDetails, postgresErrorCode } from '../errorCode';

describe('safe authentication error diagnostics', () => {
  it('reads wrapped PostgreSQL codes without retaining personal query data', () => {
    const error = Object.assign(new Error('insert users params: private@example.com secret-token'), {
      query: 'insert users', params: ['private@example.com', 'secret-token'],
      cause: Object.assign(new Error('column session_valid_after missing'), { code: '42703' }),
    });
    expect(postgresErrorCode(error)).toBe('42703');
    expect(authFailureLogDetails(error)).toEqual({ code: 'AUTH_CALLBACK_FAILED', databaseCode: '42703' });
    expect(JSON.stringify(authFailureLogDetails(error))).not.toMatch(/private@|secret-token|insert users/);
  });
  it('preserves safe application codes', () => {
    expect(authFailureLogDetails({ code: 'ACCOUNT_SUSPENDED', email: 'private@example.com' }))
      .toEqual({ code: 'ACCOUNT_SUSPENDED' });
  });
  it('rejects arbitrary strings and terminates cyclic causes', () => {
    const error: {code: string; cause?: unknown} = { code: 'private@example.com' };
    error.cause = error;
    expect(postgresErrorCode(error)).toBeUndefined();
    expect(authFailureLogDetails(error)).toEqual({ code: 'AUTH_CALLBACK_FAILED' });
    expect(authFailureLogDetails(null)).toEqual({ code: 'AUTH_CALLBACK_FAILED' });
  });
});
