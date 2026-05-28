import { defineStore } from 'pinia';
import { clearToken, getToken, setToken } from '@/utils/auth';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '' as string,
    username: '' as string,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token),
  },
  actions: {
    hydrateFromStorage() {
      this.token = getToken();
    },
    login(token: string, username = '') {
      this.token = token;
      this.username = username;
      setToken(token);
    },
    logout() {
      this.token = '';
      this.username = '';
      clearToken();
    },
  },
});
