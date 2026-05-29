<template>
  <div class="login-page">
    <div class="login-card-wrap">
      <div class="login-card-glow"></div>

      <section class="login-card">
        <div class="card-topbar">
          <div class="status-dot"></div>
        </div>

        <div class="card-head">
          <span class="eyebrow">CREATE ACCOUNT</span>
          <h1>注册新账号</h1>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="login-form"
          label-position="top"
          @submit.prevent
        >
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" size="large" clearable autocomplete="username" />
          </el-form-item>

          <el-form-item label="邮箱 (可选)" prop="email">
            <el-input v-model="form.email" placeholder="请输入邮箱" size="large" clearable autocomplete="email" />
          </el-form-item>

          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" clearable show-password autocomplete="new-password" />
          </el-form-item>

          <el-form-item label="确认密码" prop="confirm">
            <el-input v-model="form.confirm" type="password" placeholder="请再次输入密码" size="large" clearable show-password autocomplete="new-password" />
          </el-form-item>

          <el-button type="warning" size="large" class="submit-btn" :loading="loading" @click="handleRegister">
            注册
          </el-button>

          <div class="helper-text">
            已有账号？
            <el-button link type="warning" class="helper-link-btn" @click="goLogin">去登录</el-button>
          </div>
        </el-form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { FormInstance, FormItemRule, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { registerApi } from '@/api/auth';

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: '',
  email: '',
  password: '',
  confirm: '',
});

const validateEmail: FormItemRule['validator'] = (_, value, callback) => {
  if (!value) {
    callback();
    return;
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(String(value))) {
    callback(new Error('邮箱格式不正确'));
    return;
  }
  callback();
};

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  email: [{ validator: validateEmail, trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  confirm: [{ required: true, message: '请确认密码', trigger: 'blur' }],
};

const goLogin = () => {
  router.push('/login');
};

const handleRegister = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if (form.password !== form.confirm) {
      ElMessage.error('两次输入的密码不一致');
      return;
    }

    loading.value = true;
    try {
      const payload = {
        username: form.username.trim(),
        password: form.password,
        email: form.email?.trim() || undefined,
      };
      const res = await registerApi(payload);
      ElMessage.success(res.data || '注册成功');
      await router.push('/login');
    } catch (err) {
      // http 库会显示消息
    } finally {
      loading.value = false;
    }
  });
};
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 20% 15%, rgba(247, 213, 74, 0.35), transparent 24%),
    radial-gradient(circle at 80% 18%, rgba(255, 236, 145, 0.3), transparent 18%),
    linear-gradient(135deg, #fbfbfb 0%, #f4f5f7 100%);
}

.login-card-wrap {
  position: relative;
  width: min(560px, 100%);
}

.login-card-glow {
  position: absolute;
  inset: -18px;
  border-radius: 34px;
  background: radial-gradient(circle, rgba(247, 213, 74, 0.28), transparent 68%);
  filter: blur(10px);
  pointer-events: none;
}

.login-card {
  position: relative;
  padding: 26px;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    0 24px 70px rgba(24, 24, 24, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
}

.card-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f7d54a 0%, #ffeaa4 100%);
  box-shadow: 0 0 0 8px rgba(247, 213, 74, 0.16);
}

.card-head {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}

.eyebrow {
  color: #a98b19;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.18em;
}

.card-head h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.08;
  letter-spacing: -0.04em;
  color: #1f2329;
}

.login-form {
  display: grid;
  gap: 0;
}

.actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.submit-btn {
  width: 100%;
  margin-top: 12px;
  border-radius: 16px;
  font-weight: 700;
  height: 48px;
}

.helper-text {
  margin-top: 8px;
  color: #8a92a2;
  font-size: 13px;
  line-height: 1.7;
}

.helper-link-btn {
  padding: 0;
  font-size: 13px;
  vertical-align: baseline;
}

@media (max-width: 640px) {
  .login-page {
    padding: 14px;
  }

  .login-card {
    padding: 18px;
    border-radius: 24px;
  }

  .card-head {
    gap: 6px;
  }
}
</style>
