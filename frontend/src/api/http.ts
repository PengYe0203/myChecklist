import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';
import { getToken, clearToken } from '@/utils/auth';

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response: AxiosResponse<ApiResult<unknown>>) => {
    const { data } = response;
    if (data?.code === 200) {
      return data;
    }
    if (data?.code === 401) {
      clearToken();
      router.push('/login');
      return Promise.reject(new Error(data.message || '未登录'));
    }
    ElMessage.error(data?.message || '请求失败');
    return Promise.reject(new Error(data?.message || '请求失败'));
  },
  (error: AxiosError<ApiResult<unknown>>) => {
    const status = error.response?.status;
    if (status === 401) {
      clearToken();
      router.push('/login');
      return Promise.reject(error);
    }
    const message = error.response?.data?.message || error.message || '网络异常';
    ElMessage.error(message);
    return Promise.reject(error);
  },
);

export default http;
