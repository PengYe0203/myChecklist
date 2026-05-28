import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import LoginView from '@/views/LoginView.vue';
import RegisterView from '@/views/RegisterView.vue';
import ResetPasswordView from '@/views/ResetPasswordView.vue';
import HomeView from '@/views/HomeView.vue';
import { getToken } from '@/utils/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { public: true },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: ResetPasswordView,
      meta: { public: true },
    },
    {
      path: '/home',
      name: 'home',
      component: HomeView,
    },
  ],
});

router.beforeEach((to) => {
  const token = getToken();
  if (to.meta.public) {
    if (token && to.path === '/login') {
      return '/home';
    }
    return true;
  }

  if (!token) {
    ElMessage.warning('请先登录');
    return '/login';
  }

  return true;
});

export default router;
