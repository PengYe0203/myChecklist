<template>
  <div class="home-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">☀</div>
        <div>
          <div class="brand-title">MyChecklist</div>
          <div class="brand-subtitle">今日清单</div>
        </div>
      </div>

      <nav class="nav-list">
        <button class="nav-item active">我的一天</button>
        <button class="nav-item">重要</button>
        <button class="nav-item">计划内</button>
        <button class="nav-item">已分配给我</button>
        <button class="nav-item">任务树</button>
      </nav>
    </aside>

    <main class="content-area">
      <header class="content-topbar">
        <div>
          <h1>我的一天</h1>
          <p>{{ todayLabel }}</p>
        </div>
        <el-button type="warning" plain @click="handleLogout">退出登录</el-button>
      </header>

      <section class="task-card">
        <div class="task-input-row">
          <el-input v-model="draftTask" placeholder="添加任务" size="large" />
          <el-button type="warning">添加</el-button>
        </div>
        <div class="task-empty">这里先作为主页面布局骨架，后续接任务树和日志详情。</div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const authStore = useAuthStore();
const draftTask = ref('');

const todayLabel = computed(() => {
  const date = new Date();
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
});

const handleLogout = async () => {
  authStore.logout();
  await router.push('/login');
};
</script>

<style scoped>
.home-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  background: linear-gradient(180deg, #fafafa 0%, #f3f4f6 100%);
}

.sidebar {
  padding: 20px 14px;
  background: #ffffff;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px 22px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #f7d54a 0%, #ffe87a 100%);
  color: #8f6b00;
  font-weight: 700;
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
}

.brand-subtitle {
  color: #8a92a2;
  font-size: 12px;
}

.nav-list {
  display: grid;
  gap: 6px;
}

.nav-item {
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: #394150;
  font-size: 14px;
  cursor: pointer;
}

.nav-item.active,
.nav-item:hover {
  background: rgba(247, 213, 74, 0.2);
  color: #1f2329;
}

.content-area {
  padding: 28px;
}

.content-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.content-topbar h1 {
  margin: 0 0 6px;
  font-size: 28px;
}

.content-topbar p {
  margin: 0;
  color: #8a92a2;
}

.task-card {
  padding: 20px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16px 40px rgba(24, 24, 24, 0.06);
}

.task-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
}

.task-empty {
  margin-top: 18px;
  min-height: 280px;
  border-radius: 16px;
  border: 1px dashed rgba(0, 0, 0, 0.1);
  display: grid;
  place-items: center;
  color: #8a92a2;
}

@media (max-width: 900px) {
  .home-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
}
</style>
