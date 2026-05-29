<template>
  <div class="reset-page">
    <div class="reset-card-wrap">
      <div class="reset-card-glow"></div>

      <section class="reset-card">
        <div class="card-topbar">
          <div class="status-dot"></div>
        </div>

        <div class="card-head">
          <span class="eyebrow">PASSWORD RESET</span>
          <h1>重置密码</h1>
          <p class="subline">先发送验证码，再用验证码设置新密码。</p>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="reset-form"
          label-position="top"
          @submit.prevent
        >
          <el-form-item label="邮箱" prop="email">
            <el-input
              v-model="form.email"
              placeholder="请输入注册邮箱"
              size="large"
              clearable
              autocomplete="email"
            >
              <template #append>
                <el-button :loading="sendingCode" :disabled="resendCountdown > 0" @click="handleSendCode">
                  {{ resendCountdown > 0 ? `${resendCountdown}s 后重发` : '发送验证码' }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item label="验证码" prop="code">
            <el-input
              v-model="form.code"
              placeholder="请输入 6 位验证码"
              size="large"
              clearable
              maxlength="6"
              autocomplete="one-time-code"
            />
          </el-form-item>

          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="form.newPassword"
              type="password"
              placeholder="请输入新密码"
              size="large"
              clearable
              show-password
              autocomplete="new-password"
            />
          </el-form-item>

          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              size="large"
              clearable
              show-password
              autocomplete="new-password"
            />
          </el-form-item>

          <el-button
            type="warning"
            size="large"
            class="submit-btn"
            :loading="loading"
            @click="handleReset"
          >
            重置密码
          </el-button>

          <div class="helper-text">
            想起来密码了？ <router-link to="/login">返回登录</router-link>
          </div>
        </el-form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { FormInstance, FormItemRule, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { resetPasswordWithCodeApi, sendVerificationCodeApi } from '@/api/auth';

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const sendingCode = ref(false);
const resendCountdown = ref(0);
let countdownTimer: number | null = null;

const form = reactive({
  email: '',
  code: '',
  newPassword: '',
  confirmPassword: '',
});

const validateEmail: FormItemRule['validator'] = (_, value, callback) => {
  if (!value) {
    callback(new Error('请输入邮箱'));
    return;
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(String(value))) {
    callback(new Error('邮箱格式不正确'));
    return;
  }
  callback();
};

const validateConfirm: FormItemRule['validator'] = (_, value, callback) => {
  if (!value) {
    callback(new Error('请确认新密码'));
    return;
  }
  if (String(value) !== form.newPassword) {
    callback(new Error('两次输入的新密码不一致'));
    return;
  }
  callback();
};

const rules: FormRules = {
  email: [{ validator: validateEmail, trigger: 'blur' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
  newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
  confirmPassword: [{ validator: validateConfirm, trigger: 'blur' }],
};

const startCountdown = (seconds = 60) => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  resendCountdown.value = seconds;
  countdownTimer = window.setInterval(() => {
    if (resendCountdown.value <= 1) {
      if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      resendCountdown.value = 0;
      return;
    }
    resendCountdown.value -= 1;
  }, 1000);
};

onBeforeUnmount(() => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
});

const handleSendCode = async () => {
  if (!form.email) {
    ElMessage.warning('请先输入邮箱');
    return;
  }
  if (resendCountdown.value > 0) {
    return;
  }

  sendingCode.value = true;
  try {
    const response = await sendVerificationCodeApi({ email: form.email.trim() });
    ElMessage.success(response.data || '验证码已发送，请查收邮箱');
    startCountdown(60);
  } catch (error) {
    // http 层会处理错误提示
  } finally {
    sendingCode.value = false;
  }
};

const handleReset = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;
    try {
      const response = await resetPasswordWithCodeApi({
        email: form.email.trim(),
        code: form.code.trim(),
        newPassword: form.newPassword,
      });
      ElMessage.success(response.data || '密码重置成功');
      await router.push('/login');
    } catch (error) {
      // http 层会处理错误提示
    } finally {
      loading.value = false;
    }
  });
};
</script>

<style scoped>
.reset-page {
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

.reset-card-wrap {
  position: relative;
  width: min(560px, 100%);
}

.reset-card-glow {
  position: absolute;
  inset: -18px;
  border-radius: 34px;
  background: radial-gradient(circle, rgba(247, 213, 74, 0.28), transparent 68%);
  filter: blur(10px);
  pointer-events: none;
}

.reset-card {
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

.subline {
  margin: 0;
  color: #697386;
  font-size: 14px;
  line-height: 1.7;
}

.reset-form {
  display: grid;
  gap: 0;
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

@media (max-width: 640px) {
  .reset-page {
    padding: 14px;
  }

  .reset-card {
    padding: 18px;
    border-radius: 24px;
  }

  .card-head {
    gap: 6px;
  }
}
</style>