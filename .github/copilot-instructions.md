# 项目概述
- 后端：Spring Boot 3 + Maven，代码在 backend/ 目录
- 前端：Vue 3，代码在 frontend/ 目录
- 部署：Docker + docker-compose

# 后端结构
- `controller/`：处理 HTTP 请求，定义 API 端点
- `service/`：业务逻辑层，提供接口
- `service/impl`：业务逻辑实现
- `aspect/`：日志切面，生成taskLog
- `config/`：异常处理、JWT配置、鉴权配置
- `component/`: 凌晨四点结算和心跳超时判定
- `entity/`：数据库实体类
- `mapper/`：MyBatis-Plus Mapper接口
- `model/`：Vo、Dto等数据传输对象
- `util/`：Cron表达式处理、JWT工具、Redis工具、Result响应规范

# HomeView.vue 任务面板速查表

> 文件：`frontend/src/views/HomeView.vue`

## 五组任务模板分布

常规任务（#1-#4）共享相同的卡片结构，在模板中重复了 **4 次**。
场景树（#5）使用 `v-if="isScene(data)"` 区分场景节点和子任务节点：
场景节点用独立样式，子任务复用常规任务卡片结构。

| # | 面板 | section | 定位特征 | tree 变量 | 特殊点 |
|---|------|---------|---------|----------|-------|
| 1 | **今日任务** | `today` | 紧接 `v-if="activeSection === 'today'"` | `currentTodayTree` | `stroke-width="6"` |
| 2 | **今日待办** | `todo` 左 | 紧接 `panel-head-title">今日待办` | `currentTodoTodayTree` | `stroke-width="4"` |
| 3 | **后续待办** | `todo` 右 | 紧接 `panel-head-title">后续待办` | `currentTodoFutureTree` | `stroke-width="4"` |
| 4 | **非场景任务** | `all` 右 | 紧接 `panel-head-title">非场景任务` | `nonSceneTaskTree` | `stroke-width="4"` |
| 5 | **场景管理** | `all` 左 | `class="task-tree scene-tree"` | `sceneTaskTree` | 双层模板：场景用 scene-node，子任务用常规 card |

## 模板 gist（#1-#4 共用）

```
<el-tree class="task-tree" :data="currentXxxTree" ...>
  <template #default="{ data }">
    <div class="task-node">
      <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
        <div class="task-node-title-row">
          <el-tooltip> <span class="active-dot" /> </el-tooltip>
          <el-icon v-if="type==='1'"><Clock /></el-icon>  <!-- 周期 -->
          <el-icon v-else-if="type==='2'"><Calendar /></el-icon>  <!-- DDL -->
          <el-icon v-else><Document /></el-icon>  <!-- 随手记 -->
          <span class="task-node-title">{{ data.title }}</span>
          <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
          <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
          <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
            <button class="task-run-toggle" @click.stop="toggleRunStatus(data)">
              <VideoPause v-if="isHeartbeatTask(data)" />
              <VideoPlay v-else />
            </button>
            <div class="task-node-clock-bar">
              <el-progress :percentage="progressPercent(data)" :show-text="false" />
              <span class="clock-progress-text">{{ clockLabel(data) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="task-node-actions">
        完成/撤回 | 编辑 | 细分 | 启用/停用 | 删除
      </div>
    </div>
  </template>
</el-tree>
```

## 场景模板 gist（#5 — 双层条件渲染）

```
<el-tree class="task-tree scene-tree" :data="sceneTaskTree" ...>
  <template #default="{ data }">
    <!-- 场景节点 -->
    <div v-if="isScene(data)" class="task-node scene-node">
      <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
        <div class="task-node-title-row scene-title-row">
          <el-icon class="task-type-icon-scene"><Folder /></el-icon>
          <span class="task-node-title scene-node-title">{{ data.title }}</span>
          <span class="task-node-desc scene-node-desc">{{ formatTaskMetaSummary(data) }}</span>
        </div>
      </div>
      <div class="task-node-actions">
        启用/停用 | 编辑 | 新建 | 删除
      </div>
    </div>
    <!-- 场景内子任务：与 #1-#4 结构一致 -->
    <div v-else class="task-node">
      （常规任务卡片，含状态点、图标、标题、子任务徽标、描述、时钟条、操作按钮）
    </div>
  </template>
</el-tree>
```

## 相关 JS/TS 逻辑（均在 `<script setup>` 中）

| 功能 | 函数/变量 | 用途 |
|------|----------|------|
| 树构建 | `buildTree()` → `currentAllTree` | 从 `allTasks` 构建全量树 |
| 过滤函数 | `isScene`, `isTodayTask`, `isTodoTask`, `isTodoTodayTask`, `isTodoFutureTask` | 五组面板的数据源 |
| 场景过滤 | `filterSceneTree()`, `filterNonSceneTree()` | 拆分场景/非场景。`filterSceneTree` 场景节点保留全部子孙不过滤 |
| 通用过滤 | `filterTree(nodes, predicate)` | 递归过滤树 |
| 计数 | `countTree(nodes)` | 侧边栏数字 |
| 运行状态 | `isHeartbeatTask()`, `toggleRunStatus()`, `liveActual()`, `progressPercent()`, `clockLabel()` | 播放/暂停 & 进度条 |
| 操作 | `toggleActive()`, `toggleComplete()`, `deleteTask()` | 启停/完成/删除 |
| 编辑弹窗 | `openCreateTaskDialog()`, `openEditTaskDialog()`, `openViewTaskDialog()` | 新建/编辑/查看 |
| 周期解析 | `parseCronConfig()`, `isRecurringTaskToday()` | 周期任务的今日判断 |
| 对话框 | `taskForm`, `buildTaskPayload()`, `submitTaskDialog()` | 任务表单提交 |

## 修改清单（确保不遗漏）

修改**常规任务卡片**时，必须同步 **5 处**模板：

1. `today` 面板的 `<template #default="{ data }">`
2. `todo` 今日待办的 `<template #default="{ data }">`
3. `todo` 后续待办的 `<template #default="{ data }">`
4. `all` 非场景任务的 `<template #default="{ data }">`
5. `all` 场景管理的场景树 `#default` 中 `v-else` 分支（场景内子任务复用常规卡片）

修改**场景卡片样式**时只需改 **1 处**：

6. `all` 场景管理的 `#default` 中 `v-if="isScene(data)"` 分支，class 带 `scene-` 前缀

修改运行状态/进度条逻辑时：

7. `liveActual()`, `progressPercent()`, `clockLabel()`, `isHeartbeatTask()`, `toggleRunStatus()`
8. 心跳定时器 `startHeartbeatTimer()` / `stopHeartbeatTimer()`



