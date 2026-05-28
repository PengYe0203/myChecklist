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
