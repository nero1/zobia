import axios from 'axios';

export const apiClient = axios.create({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});
