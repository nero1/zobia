let _preAuthToken: string | null = null;

export const getPreAuthToken = () => _preAuthToken;
export const setPreAuthToken = (token: string | null) => {
  _preAuthToken = token;
};
