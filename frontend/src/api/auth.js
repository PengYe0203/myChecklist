import http from './http';
export const loginApi = (payload) => {
    return http.post('/auth/login', payload);
};
export const registerApi = (payload) => {
    return http.post('/auth/register', payload);
};
export const sendVerificationCodeApi = (payload) => {
    return http.post('/auth/send-code', payload);
};
export const resetPasswordWithCodeApi = (payload) => {
    return http.post('/auth/reset-password-with-code', payload);
};
