import { defineStore } from 'pinia';
import { clearToken, clearUsername, getToken, getUsername, setToken, setUsername } from '@/utils/auth';

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
      this.username = getUsername();
    },
    login(token: string, username = '') {
      this.token = token;
      this.username = username;
      setToken(token);
      setUsername(username);
    },
    logout() {
      this.token = '';
      this.username = '';
      clearToken();
      clearUsername();
    },
  },
});
