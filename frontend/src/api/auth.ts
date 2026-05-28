import http, { ApiResult } from './http';

export interface LoginPayload {
  username: string;
  password: string;
}

export const loginApi = (payload: LoginPayload) => {
  return http.post('/auth/login', payload) as Promise<ApiResult<string>>;
};

export interface RegisterPayload {
  username: string;
  password: string;
  email?: string;
}

export const registerApi = (payload: RegisterPayload) => {
  return http.post('/auth/register', payload) as Promise<ApiResult<string>>;
};

export interface SendCodePayload {
  email: string;
}

export const sendVerificationCodeApi = (payload: SendCodePayload) => {
  return http.post('/auth/send-code', payload) as Promise<ApiResult<string>>;
};

export interface ResetPasswordWithCodePayload {
  email: string;
  code: string;
  newPassword: string;
}

export const resetPasswordWithCodeApi = (payload: ResetPasswordWithCodePayload) => {
  return http.post('/auth/reset-password-with-code', payload) as Promise<ApiResult<string>>;
};
