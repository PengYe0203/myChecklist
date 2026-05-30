import { defineStore } from 'pinia';
import { clearToken, clearUsername, getToken, getUsername, setToken, setUsername } from '@/utils/auth';
export const useAuthStore = defineStore('auth', {
    state: () => ({
        token: '',
        username: '',
    }),
    getters: {
        isLoggedIn: (state) => Boolean(state.token),
    },
    actions: {
        hydrateFromStorage() {
            this.token = getToken();
            this.username = getUsername();
        },
        login(token, username = '') {
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
