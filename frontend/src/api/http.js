import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';
import { getToken, clearToken } from '@/utils/auth';
const http = axios.create({
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
http.interceptors.response.use(((response) => {
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
}), ((error) => {
    const status = error.response?.status;
    if (status === 401) {
        clearToken();
        router.push('/login');
        ElMessage.error('登录已过期，请重新登录');
        return Promise.reject(error);
    }
    if (status === 403) {
        clearToken();
        router.push('/login');
        ElMessage.error('没有权限或登录已过期，请重新登录');
        return Promise.reject(error);
    }
    const message = error.response?.data?.message || error.message || '网络异常';
    ElMessage.error(message);
    return Promise.reject(error);
}));
export default http;
