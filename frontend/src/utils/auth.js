const TOKEN_KEY = 'mychecklist_token';
const USERNAME_KEY = 'mychecklist_username';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (token) => {
    localStorage.setItem(TOKEN_KEY, token);
};
export const clearToken = () => {
    localStorage.removeItem(TOKEN_KEY);
};
export const getUsername = () => localStorage.getItem(USERNAME_KEY) ?? '';
export const setUsername = (username) => {
    localStorage.setItem(USERNAME_KEY, username);
};
export const clearUsername = () => {
    localStorage.removeItem(USERNAME_KEY);
};
