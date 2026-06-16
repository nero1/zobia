import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';

export const apiClient = axios.create({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// WEB-AUTH-01: module-level lock — if multiple requests get 401 simultaneously,
// only one refresh call is made; all concurrent callers await the same promise.
let webRefreshPromise: Promise<boolean> | null = null;

async function refreshWebToken(): Promise<boolean> {
  if (webRefreshPromise) return webRefreshPromise;

  webRefreshPromise = (async () => {
    try {
      const res = await axios.post('/api/auth/refresh', null, {
        withCredentials: true,
        timeout: 10_000,
      });
      return res.status === 200;
    } catch {
      return false;
    } finally {
      webRefreshPromise = null;
    }
  })();

  return webRefreshPromise;
}

// Response interceptor — on 401, attempt a silent cookie-based token refresh,
// then retry the original request exactly once. The server sets the new
// access-token cookie on a successful refresh, so no manual header mutation
// is needed before retrying.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;

      const refreshed = await refreshWebToken();
      if (refreshed) {
        return apiClient(originalRequest);
      }
    }

    return Promise.reject(error);
  },
);
