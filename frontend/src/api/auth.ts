import http, { ApiResult } from './http';

export interface LoginPayload {
  username: string;
  password: string;
}

export const loginApi = (payload: LoginPayload) => {
  return http.post('/auth/login', payload) as Promise<ApiResult<string>>;
};
