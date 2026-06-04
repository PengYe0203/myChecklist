<template>
  <div class="home-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">☀</div>
        <div>
          <div class="brand-title">MyChecklist</div>
        </div>
      </div>

      <div class="user-card">
        <div class="user-card-icon">👤</div>
        <div class="user-card-content">
          <div class="user-card-name">{{ displayUsername }}</div>
        </div>
      </div>

      <nav class="nav-list">
        <button
          v-for="item in sectionItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeSection === item.key }"
            @click="setActiveSection(item.key)"
        >
          <span>{{ item.label }}</span>
          <small>{{ item.countLabel }}</small>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <el-button class="logout-btn" type="warning" plain @click="handleLogout">退出登录</el-button>
      </div>
    </aside>

    <main class="content-area">
      <header class="content-topbar">
        <div>
          <h1>{{ activeSectionTitle }}</h1>
          <p>{{ todayLabel }}</p>
        </div>
      </header>
      <div v-if="activeSection === 'today'" class="section-toolbar section-toolbar-left">
        <el-button type="warning" @click="openCreateTaskDialog()">新建任务</el-button>
        <el-button type="warning" plain :loading="loadingTasks" @click="loadTasks">刷新任务</el-button>
      </div>
      <section v-if="activeSection === 'today'" class="panel-card">
        <el-empty v-if="!currentTodayTree.length && !loadingTasks" description="当前没有今日任务" />

        <el-tree
          v-else
          class="task-tree"
          :data="currentTodayTree"
          node-key="taskId"
          :props="treeProps"
          :expand-on-click-node="false"
        >
          <template #default="{ data }">
            <div class="task-node">
              <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                <div class="task-node-title-row">
                  <el-tooltip placement="top" :content="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')">
                    <span :class="['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]" role="img" :aria-label="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')" />
                  </el-tooltip>
                  <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(data.type) === '1'">
                    <Clock />
                  </el-icon>
                  <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(data.type) === '2'">
                    <Calendar />
                  </el-icon>
                  <el-icon class="task-type-icon task-type-icon-note" v-else>
                    <Document />
                  </el-icon>
                  <span class="task-node-title">{{ data.title }}</span>
                  <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
                  <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                  <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
                    <button type="button" class="task-run-toggle" @click.stop="toggleRunStatus(data)">
                      <el-icon>
                        <VideoPause v-if="isHeartbeatTask(data)" />
                        <VideoPlay v-else />
                      </el-icon>
                    </button>
                    <div class="task-node-clock-bar">
                      <el-progress :percentage="progressPercent(data)" :show-text="false" :stroke-width="6" :color="'#93c5fd'" />
                      <span class="clock-progress-text">{{ clockLabel(data) }}</span>
                    </div>
                  
                </div>
              </div>
                <div class="task-node-actions">
                <el-button size="small" type="success" :class="data.isCompleted ? 'btn-revoke' : ''" @click.stop="toggleComplete(data)">
                  {{ data.isCompleted ? '撤回' : '完成' }}
                </el-button>
                <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data)">细分</el-button>
                <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                  {{ data.active ? '停用' : '启用' }}
                </el-button>
                <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>
            </div>
          </template>
        </el-tree>
      </section>

      <section v-if="activeSection === 'today'" class="review-editor-card panel-card" style="margin-top: 18px;">
        <div class="panel-head">
          <div>
            <h3>今日总结</h3>
          </div>
          <div class="panel-head-actions">
            <el-button plain @click="saveDraft">保存草稿</el-button>
            <el-button type="warning" :loading="savingReview" @click="saveReviewToServer">保存</el-button>
          </div>
        </div>

        <el-input
          v-model="reviewDraft"
          type="textarea"
          :rows="11"
          maxlength="2000"
          show-word-limit
          placeholder="写下今天的 review content..."
        />
      </section>

      <div v-if="activeSection === 'todo'" class="section-toolbar section-toolbar-left">
        <el-button type="warning" @click="openCreateTaskDialog()">新建任务</el-button>
        <el-button type="warning" plain :loading="loadingTasks" @click="loadTasks">刷新任务</el-button>
      </div>
      <section v-if="activeSection === 'todo'" class="task-split-layout">
        <div class="panel-card task-split-card">
          <div class="panel-head panel-head-stacked panel-head-actions-left">
            <div class="panel-head-title">今日待办</div>
          </div>

          <el-empty v-if="!currentTodoTodayTree.length && !loadingTasks" description="当前没有今日待办" />

          <el-tree
            v-else
            class="task-tree"
            :data="currentTodoTodayTree"
            node-key="taskId"
            :props="treeProps"
            :expand-on-click-node="false"
          >
            <template #default="{ data }">
              <div class="task-node">
                <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                  <div class="task-node-title-row">
                    <el-tooltip placement="top" :content="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')">
                      <span :class="['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]" role="img" :aria-label="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')" />
                    </el-tooltip>
                    <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(data.type) === '1'">
                      <Clock />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(data.type) === '2'">
                      <Calendar />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-note" v-else>
                      <Document />
                    </el-icon>
                      <span class="task-node-title">{{ data.title }}</span>
                      <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
                      <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                      <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
                        <button type="button" class="task-run-toggle" @click.stop="toggleRunStatus(data)">
                          <el-icon>
                            <VideoPause v-if="isHeartbeatTask(data)" />
                            <VideoPlay v-else />
                          </el-icon>
                        </button>
                        <div class="task-node-clock-bar">
                          <el-progress :percentage="progressPercent(data)" :show-text="false" :stroke-width="4" :color="'#93c5fd'" />
                          <span class="clock-progress-text">{{ clockLabel(data) }}</span>
                        </div>
                      </div>
                    
                  </div>
                </div>

                <div class="task-node-actions">
                  <el-button size="small" type="success" :class="data.isCompleted ? 'btn-revoke' : ''" @click.stop="toggleComplete(data)">
                    {{ data.isCompleted ? '撤回' : '完成' }}
                  </el-button>
                  <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                  <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data)">细分</el-button>
                  <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                    {{ data.active ? '停用' : '启用' }}
                  </el-button>
                  <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>
            </template>
          </el-tree>
        </div>

        <div class="panel-card task-split-card">
          <div class="panel-head panel-head-stacked panel-head-actions-left">
            <div class="panel-head-title">后续待办</div>
          </div>

          <el-empty v-if="!currentTodoFutureTree.length && !loadingTasks" description="当前没有后续待办" />

          <el-tree
            v-else
            class="task-tree"
            :data="currentTodoFutureTree"
            node-key="taskId"
            :props="treeProps"
            :expand-on-click-node="false"
          >
            <template #default="{ data }">
              <div class="task-node">
                <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                  <div class="task-node-title-row">
                    <el-tooltip placement="top" :content="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')">
                      <span :class="['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]" role="img" :aria-label="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')" />
                    </el-tooltip>
                    <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(data.type) === '1'">
                      <Clock />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(data.type) === '2'">
                      <Calendar />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-note" v-else>
                      <Document />
                    </el-icon>
                    <span class="task-node-title">{{ data.title }}</span>
                    <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
                    <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                    <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
                      <button type="button" class="task-run-toggle" @click.stop="toggleRunStatus(data)">
                        <el-icon>
                          <VideoPause v-if="isHeartbeatTask(data)" />
                          <VideoPlay v-else />
                        </el-icon>
                      </button>
                      <div class="task-node-clock-bar">
                        <el-progress :percentage="progressPercent(data)" :show-text="false" :stroke-width="4" :color="'#93c5fd'" />
                        <span class="clock-progress-text">{{ clockLabel(data) }}</span>
                      </div>
                    </div>
                    
                  </div>

                </div>

                <div class="task-node-actions">
                  <el-button size="small" type="success" :class="data.isCompleted ? 'btn-revoke' : ''" @click.stop="toggleComplete(data)">
                    {{ data.isCompleted ? '撤回' : '完成' }}
                  </el-button>
                  <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                  <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data)">细分</el-button>
                  <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                    {{ data.active ? '停用' : '启用' }}
                  </el-button>
                  <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>
            </template>
          </el-tree>
        </div>
      </section>

      <section v-else-if="activeSection === 'all'" class="task-split-layout">
        <div class="panel-card task-split-card">
          <div class="panel-head panel-head-stacked panel-head-actions-left">
            <div class="panel-head-title">场景管理</div>
            <div class="panel-head-actions">
              <el-button type="warning" @click="openCreateSceneDialog()">新建场景</el-button>
              <el-button type="warning" plain :loading="loadingTasks" @click="loadTasks">刷新任务</el-button>
            </div>
          </div>

          <el-empty v-if="!sceneTaskTree.length && !loadingTasks" description="当前没有场景" />

          <el-tree
            v-else
            class="task-tree scene-tree"
            :data="sceneTaskTree"
            node-key="taskId"
            :props="treeProps"
            :expand-on-click-node="false"
          >
            <template #default="{ data }">
              <!-- 场景节点：保持场景风格 -->
              <div v-if="isScene(data)" class="task-node scene-node">
                <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                  <div class="task-node-title-row scene-title-row">
                    <el-icon class="task-type-icon task-type-icon-scene">
                      <Folder />
                    </el-icon>
                    <span class="task-node-title scene-node-title">{{ data.title }}</span>
                    <span v-if="formatTaskMetaSummary(data)" class="task-node-desc scene-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                  </div>
                </div>

                <div class="task-node-actions">
                  <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                    {{ data.active ? '停用' : '启用' }}
                  </el-button>
                  <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                  <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data, false)">新建</el-button>
                  <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>

              <!-- 场景内的子任务：常规任务卡片 -->
              <div v-else class="task-node">
                <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                  <div class="task-node-title-row">
                    <el-tooltip placement="top" :content="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')">
                      <span :class="['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]" role="img" :aria-label="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')" />
                    </el-tooltip>
                    <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(data.type) === '1'">
                      <Clock />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(data.type) === '2'">
                      <Calendar />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-note" v-else>
                      <Document />
                    </el-icon>
                    <span class="task-node-title">{{ data.title }}</span>
                    <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
                    <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                    <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
                      <button type="button" class="task-run-toggle" @click.stop="toggleRunStatus(data)">
                        <el-icon>
                          <VideoPause v-if="isHeartbeatTask(data)" />
                          <VideoPlay v-else />
                        </el-icon>
                      </button>
                      <div class="task-node-clock-bar">
                        <el-progress :percentage="progressPercent(data)" :show-text="false" :stroke-width="4" :color="'#93c5fd'" />
                        <span class="clock-progress-text">{{ clockLabel(data) }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="task-node-actions">
                  <el-button size="small" type="success" :class="data.isCompleted ? 'btn-revoke' : ''" @click.stop="toggleComplete(data)">
                    {{ data.isCompleted ? '撤回' : '完成' }}
                  </el-button>
                  <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                  <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data)">细分</el-button>
                  <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                    {{ data.active ? '停用' : '启用' }}
                  </el-button>
                  <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>
            </template>
          </el-tree>
        </div>

        <div class="panel-card task-split-card">
          <div class="panel-head panel-head-stacked panel-head-actions-left">
            <div class="panel-head-title">非场景任务</div>
            <div class="panel-head-actions">
              <el-button type="warning" @click="openCreateTaskDialog(null, false)">新建任务</el-button>
              <el-button type="warning" plain :loading="loadingTasks" @click="loadTasks">刷新任务</el-button>
            </div>
          </div>

          <el-empty v-if="!nonSceneTaskTree.length && !loadingTasks" description="当前没有非场景任务" />

          <el-tree
            v-else
            class="task-tree"
            :data="nonSceneTaskTree"
            node-key="taskId"
            :props="treeProps"
            :expand-on-click-node="false"
          >
            <template #default="{ data }">
              <div class="task-node">
                <div class="task-node-main" @click.stop="openViewTaskDialog(data)">
                  <div class="task-node-title-row">
                    <el-tooltip placement="top" :content="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')">
                      <span :class="['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]" role="img" :aria-label="data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')" />
                    </el-tooltip>
                    <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(data.type) === '1'">
                      <Clock />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(data.type) === '2'">
                      <Calendar />
                    </el-icon>
                    <el-icon class="task-type-icon task-type-icon-note" v-else>
                      <Document />
                    </el-icon>
                    <span class="task-node-title">{{ data.title }}</span>
                    <span v-if="data.children?.length" class="task-node-children-badge">+{{ data.children.length }}</span>
                    <span v-if="formatTaskMetaSummary(data)" class="task-node-desc">{{ formatTaskMetaSummary(data) }}</span>
                    <div class="task-node-clock" :class="{ 'is-running': isHeartbeatTask(data) }">
                      <button type="button" class="task-run-toggle" @click.stop="toggleRunStatus(data)">
                        <el-icon>
                          <VideoPause v-if="isHeartbeatTask(data)" />
                          <VideoPlay v-else />
                        </el-icon>
                      </button>
                      <div class="task-node-clock-bar">
                        <el-progress :percentage="progressPercent(data)" :show-text="false" :stroke-width="4" :color="'#93c5fd'" />
                        <span class="clock-progress-text">{{ clockLabel(data) }}</span>
                      </div>
                    </div>
                    
                  </div>

                </div>

                <div class="task-node-actions">
                  <el-button size="small" type="success" :class="data.isCompleted ? 'btn-revoke' : ''" @click.stop="toggleComplete(data)">
                    {{ data.isCompleted ? '撤回' : '完成' }}
                  </el-button>
                  <el-button size="small" type="primary" @click.stop="openEditTaskDialog(data)">编辑</el-button>
                  <el-button size="small" class="btn-subdivide" @click.stop="openCreateTaskDialog(data)">细分</el-button>
                  <el-button size="small" :class="data.active ? 'btn-disable' : 'btn-enable'" @click.stop="toggleActive(data)">
                    {{ data.active ? '停用' : '启用' }}
                  </el-button>
                  <el-button size="small" type="danger" @click.stop="deleteTask(data)">删除</el-button>
                </div>
              </div>
            </template>
          </el-tree>
        </div>
      </section>

      <section v-if="activeSection === 'review'" class="review-layout">
        <div class="review-grid">
          <div class="panel-card review-history-card">
            <div class="panel-head">
              <div>
                <h3>历史回顾</h3>
                <p style="font-size: 0.8rem">点击任意条目查看详情</p>
              </div>
              <el-button type="warning" @click="loadReviews">刷新</el-button>
            </div>

            <el-empty v-if="!reviewHistory.length" description="还没有历史回顾" />

            <div v-else class="review-list">
              <button
                v-for="item in reviewHistory"
                :key="item.reviewId"
                class="review-item"
                :class="{ active: selectedReview?.reviewId === item.reviewId }"
                @click="selectReview(item)"
              >
                <div class="review-item-top">
                  <strong>{{ formatDateOnly(item.date) }}</strong>
                  <span>{{ item.doneCount ?? 0 }} / {{ item.totalCount ?? 0 }}</span>
                </div>
                <div class="review-item-snippet">
                  {{ reviewSnippet(item.content) }}
                </div>
              </button>
            </div>
          </div>

          <div class="panel-card review-detail-card">
            <div class="panel-head">
              <div>
                <h3>回顾详情</h3>
                <p v-if="selectedReview">{{ formatDateOnly(selectedReview.date) }}</p>
                <p v-else>点击左侧任意历史 review 查看详情。</p>
              </div>
            </div>

            <template v-if="selectedReview">
              <div class="detail-grid">
                <div class="detail-item">
                  <span>完成任务 / 任务总数</span>
                  <strong>{{ selectedReview.doneCount ?? 0 }} / {{ selectedReview.totalCount ?? 0 }}</strong>
                </div>
                <div class="detail-item">
                  <span>实际用时 / 计划用时</span>
                  <strong>{{ formatDuration(selectedReview.actualDurationSum) }} / {{ formatDuration(selectedReview.plannedDurationSum) }}</strong>
                </div>
              </div>
              <div class="detail-grid">
                <div class="detail-item">
                  <span>净时长</span>
                  <strong>{{ formatDuration(selectedReview.netFocusTime) }}</strong>
                </div>
                <div class="detail-item">
                  <span>总时长</span>
                  <strong>{{formatDuration(selectedReview.grossEffort)}}</strong>
                </div>
              </div>

              <div class="detail-block" v-if="selectedReview.timeDistribution">
                <div class="detail-block-label">时间分布</div>
                <div class="heatmap-grid">
                  <div
                    v-for="(row, rowIdx) in timeDistHeatmapRows"
                    :key="rowIdx"
                    class="heatmap-row"
                  >
                    <span class="heatmap-row-label">{{ heatmapRowRange(rowIdx) }}</span>
                    <div
                      v-for="(seg, colIdx) in row"
                      :key="colIdx"
                      class="heatmap-seg"
                      :class="{ 'is-active': seg.active }"
                      :title="seg.label"
                    />
                  </div>
                </div>
              </div>

              <div class="detail-block">
                <div class="detail-block-label">当日总结</div>
                <pre class="detail-pre">{{ selectedReview.content || '暂无内容' }}</pre>
              </div>

              <div class="detail-footer">
                <el-tag type="warning">已坚持天数:  {{ selectedReview.streakDays ?? 0 }} 天</el-tag>
              </div>

              <!-- TaskLog 列表 -->
              <div class="detail-block tasklog-section">
                <div class="detail-block-label">
                  <span>任务日志</span>
                  <span v-if="taskLogs.length" class="tasklog-count">（{{ taskLogs.length }} 条）</span>
                </div>
                <div v-if="loadingTaskLogs" class="tasklog-loading">加载中...</div>
                <el-empty v-else-if="!taskLogs.length" description="该日期暂无任务日志" :image-size="40" />
                <div v-else class="tasklog-list">
                  <button
                    v-for="logItem in taskLogs"
                    :key="logItem.logId"
                    class="tasklog-item"
                    @click="openTaskLogDetail(logItem)"
                  >
                    <div class="tasklog-item-left">
                      <el-icon class="task-type-icon task-type-icon-recurring" v-if="String(logItem.type) === '1'">
                        <Clock />
                      </el-icon>
                      <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(logItem.type) === '2'">
                        <Calendar />
                      </el-icon>
                      <el-icon class="task-type-icon task-type-icon-note" v-else>
                        <Document />
                      </el-icon>
                      <span class="tasklog-item-title">{{ logItem.title }}</span>
                    </div>
                    <div class="tasklog-item-right">
                      <span :class="['tasklog-result-tag', resultStatusClass(logItem.resultStatus)]">
                        {{ resultStatusLabel(logItem.resultStatus) }}
                      </span>
                      <span class="tasklog-duration">{{ formatDuration(logItem.dailyActualDuration) }}</span>
                    </div>
                  </button>
                </div>
              </div>
            </template>

            <el-empty v-else description="请选择一条历史 review" />
          </div>
        </div>
      </section>

      <el-dialog
        v-model="taskDialogVisible"
        :title="taskDialogTitle"
        width="620px"
        :class="['task-dialog', { 'view-mode': taskDialogMode === 'view' }]"
        destroy-on-close
        append-to-body
        @closed="resetTaskDialog"
      >
        <el-steps v-if="taskDialogMode !== 'view' && !isSceneDialog" :active="taskDialogStep" finish-status="success" align-center class="task-dialog-steps">
          <el-step title="基本信息" />
          <el-step title="时间信息" />
        </el-steps>

        <div v-if="taskDialogMode !== 'view' && taskDialogParent" class="task-dialog-parent-chip">
          <el-icon class="task-type-icon task-type-icon-scene" v-if="String(taskDialogParent.type) === '3'">
            <Folder />
          </el-icon>
          <el-icon class="task-type-icon task-type-icon-recurring" v-else-if="String(taskDialogParent.type) === '1'">
            <Clock />
          </el-icon>
          <el-icon class="task-type-icon task-type-icon-ddl" v-else-if="String(taskDialogParent.type) === '2'">
            <Calendar />
          </el-icon>
          <el-icon class="task-type-icon task-type-icon-note" v-else>
            <Document />
          </el-icon>
          <span v-if="String(taskDialogParent.type) === '3'">场景</span>
          <span v-else>父任务</span>
          <strong>{{ taskDialogParent.title }}</strong>
        </div>

        <el-alert
          v-if="taskDialogMode !== 'view'"
          v-for="warning in taskDialogWarnings"
          :key="warning"
          :title="warning"
          type="warning"
          show-icon
          :closable="false"
          class="task-dialog-alert"
        />

        <!-- Read-only view mode -->
        <div v-if="taskDialogMode === 'view'" class="task-dialog-page read-only-view">
          <div class="detail-block">
            <div class="detail-block-label">描述</div>
            <div class="detail-text">{{ taskForm.description || '无' }}</div>
          </div>

          <template v-if="String(taskForm.type) === '2'">
            <div class="detail-block">
              <div class="detail-block-label">截止日期</div>
              <div>{{ taskForm.endTime ? formatDateTime(taskForm.endTime) : '-' }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">计划用时</div>
              <div>{{ formatPlannedDuration(taskForm.targetDuration) }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">开始时间</div>
              <div>{{ taskForm.startTime ? formatDateTime(taskForm.startTime) : '-' }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">结算模式</div>
              <div>{{ settlementTypeOptions.find(o => o.value === taskForm.settlementType)?.label || '-' }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">创建时间</div>
              <div>{{ taskForm.createTime ? formatDateTime(taskForm.createTime) : '-' }}</div>
            </div>
          </template>

          <template v-else-if="isRecurringTask">
            <div class="detail-block">
              <div class="detail-block-label">循环周期</div>
              <div>{{ formatRecurrence(taskForm.cycleMode as RecurrenceMode, taskForm.cycleIntervalDays, taskForm.cycleWeekdays, taskForm.cycleMonthDays) }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">计划用时</div>
              <div>{{ formatPlannedDuration(taskForm.targetDuration) }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">起止时间</div>
              <div>
                <div>开始时间: {{ formatTimeOnly(taskForm.startTime) }}</div>
                <div>结束时间: {{ formatTimeOnly(taskForm.endTime) }}</div>
              </div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">结算模式</div>
              <div>{{ settlementTypeOptions.find(o => o.value === taskForm.settlementType)?.label || '-' }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">创建时间</div>
              <div>{{ taskForm.createTime ? formatDateTime(taskForm.createTime) : '-' }}</div>
            </div>
          </template>

          <template v-else>
            <div class="detail-block">
              <div class="detail-block-label">计划用时</div>
              <div>{{ formatPlannedDuration(taskForm.targetDuration) }}</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">时间信息</div>
              <div>
                <div>开始时间: {{ taskForm.startTime ? formatDateTime(taskForm.startTime) : '-' }}</div>
                <div>结束时间: {{ taskForm.endTime ? formatDateTime(taskForm.endTime) : '-' }}</div>
              </div>
            </div>

            <div class="detail-block">
              <div class="detail-block-label">创建时间</div>
              <div>{{ taskForm.createTime ? formatDateTime(taskForm.createTime) : '-' }}</div>
            </div>
          </template>
        </div>

        <el-form
          v-if="taskDialogMode !== 'view'"
          ref="taskFormRef"
          :model="taskForm"
          :rules="taskFormRules"
          label-position="top"
          class="task-dialog-form"
          @submit.prevent
        >
          <div v-if="isSceneDialog" class="task-dialog-page">
            <el-form-item label="场景标题" prop="title">
              <el-input v-model="taskForm.title" placeholder="请输入场景标题" maxlength="120" show-word-limit />
            </el-form-item>

            <el-form-item label="场景描述（可选）" prop="description">
              <el-input
                v-model="taskForm.description"
                type="textarea"
                :rows="5"
                maxlength="500"
                show-word-limit
                placeholder="补充场景说明"
              />
            </el-form-item>

            <el-alert
              title="场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。"
              type="info"
              show-icon
              :closable="false"
              class="task-dialog-alert"
            />
          </div>

          <template v-else>
            <div v-show="taskDialogStep === 0" class="task-dialog-page">
              <el-form-item label="标题" prop="title">
                <el-input v-model="taskForm.title" placeholder="请输入任务标题" maxlength="120" show-word-limit />
              </el-form-item>

              <el-form-item label="描述（可选）" prop="description">
                <el-input
                  v-model="taskForm.description"
                  type="textarea"
                  :rows="4"
                  maxlength="500"
                  show-word-limit
                  placeholder="补充任务说明"
                />
              </el-form-item>

              <el-row :gutter="14">
                <el-col :xs="24" :sm="12">
                  <el-form-item label="类型" prop="type">
                    <template v-if="taskForm.type !== 3">
                      <el-select v-model="taskForm.type" class="w-full">
                        <el-option
                          v-for="option in taskTypeOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </template>
                    <template v-else>
                      <el-tag type="warning">场景</el-tag>
                    </template>
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <div v-show="taskDialogStep === 1" class="task-dialog-page">
              <div v-if="isRecurringTask" class="task-dialog-section-block">
                <div class="task-dialog-section-title">循环周期</div>
                <el-row :gutter="14" class="task-recurrence-row">
                  <el-col :xs="24" :sm="10">
                    <el-form-item label="循环尺度" prop="cycleMode">
                      <el-select v-model="taskForm.cycleMode" class="w-full">
                        <el-option
                          v-for="option in cycleModeOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>
                  </el-col>

                  <el-col :xs="24" :sm="14">
                    <el-form-item v-if="taskForm.cycleMode === 'interval'" label="具体选择" prop="cycleIntervalDays">
                      <el-input-number v-model="taskForm.cycleIntervalDays" :min="1" :step="1" controls-position="right" class="w-full" />
                    </el-form-item>

                    <el-form-item v-else-if="taskForm.cycleMode === 'weekly'" label="具体选择" prop="cycleWeekdays">
                      <el-select v-model="taskForm.cycleWeekdays" multiple collapse-tags collapse-tags-tooltip class="w-full" placeholder="选择一个或多个星期">
                        <el-option
                          v-for="option in weekdayOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>

                    <el-form-item v-else-if="taskForm.cycleMode === 'monthly'" label="具体选择" prop="cycleMonthDays">
                      <el-select v-model="taskForm.cycleMonthDays" multiple collapse-tags collapse-tags-tooltip class="w-full" placeholder="选择一个或多个日期">
                        <el-option
                          v-for="option in monthDayOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>

                <div class="task-dialog-helper-text">周期任务只按天计算，不需要选择具体时分。</div>
              </div>

              <div class="task-dialog-section-block">
                <div class="task-dialog-section-title">计划用时</div>
                <el-row :gutter="14" class="task-duration-row">
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="小时" prop="planDurationHours">
                      <el-input-number v-model="taskForm.planDurationHours" :min="0" :step="1" controls-position="right" class="w-full" />
                    </el-form-item>
                  </el-col>

                  <el-col :xs="24" :sm="12">
                    <el-form-item label="分钟" prop="planDurationMinutes">
                      <el-input-number v-model="taskForm.planDurationMinutes" :min="0" :max="59" :step="1" controls-position="right" class="w-full" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>

              <div v-if="isRecurringTask" class="task-dialog-section-block">
                <div class="task-dialog-section-title">每日安排（可选）</div>
                <el-row :gutter="10" class="task-datetime-row">
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="开始时分">
                      <el-time-picker
                        :model-value="getTimePart(taskForm.startTime)"
                        format="HH:mm"
                        value-format="HH:mm:ss"
                        placeholder="选择时分"
                        class="w-full"
                        @update:model-value="updateStartTimePart"
                      />
                    </el-form-item>
                  </el-col>

                  <el-col :xs="24" :sm="12">
                    <el-form-item label="结束时分">
                      <el-time-picker
                        :model-value="getTimePart(taskForm.endTime)"
                        format="HH:mm"
                        value-format="HH:mm:ss"
                        placeholder="选择时分"
                        class="w-full"
                        @update:model-value="updateEndTimePart"
                      />
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>

              <div v-else class="task-dialog-section-block">
                <div class="task-dialog-section-title">时间信息</div>
                <el-form-item label="开始时间" prop="startTime">
                  <el-row :gutter="10" class="task-datetime-row">
                    <el-col :xs="24" :sm="12">
                      <el-date-picker
                        :model-value="getDatePart(taskForm.startTime)"
                        type="date"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        placeholder="选择日期"
                        class="w-full"
                        @update:model-value="updateStartDatePart"
                      />
                    </el-col>

                    <el-col :xs="24" :sm="12">
                      <el-time-picker
                        :model-value="getTimePart(taskForm.startTime)"
                        format="HH:mm"
                        value-format="HH:mm:ss"
                        placeholder="选择时分"
                        class="w-full"
                        @update:model-value="updateStartTimePart"
                      />
                    </el-col>
                  </el-row>
                </el-form-item>

                <el-form-item :label="String(taskForm.type) === '2' ? '完成时间' : '结束时间'" prop="endTime">
                  <el-row :gutter="10" class="task-datetime-row">
                    <el-col :xs="24" :sm="12">
                      <el-date-picker
                        :model-value="getDatePart(taskForm.endTime)"
                        type="date"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        placeholder="选择日期"
                        class="w-full"
                        @update:model-value="updateEndDatePart"
                      />
                    </el-col>

                    <el-col :xs="24" :sm="12">
                      <el-time-picker
                        :model-value="getTimePart(taskForm.endTime)"
                        format="HH:mm"
                        value-format="HH:mm:ss"
                        placeholder="选择时分"
                        class="w-full"
                        @update:model-value="updateEndTimePart"
                      />
                    </el-col>
                  </el-row>
                </el-form-item>
              </div>

              <el-form-item v-if="String(taskForm.type) !== '0'" prop="settlementType">
                <template #label>
                  <span class="task-settlement-label">
                    <span>结算模式</span>
                    <el-tooltip
                      effect="dark"
                      placement="top"
                      raw-content
                      content="自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成"
                    >
                      <span class="task-settlement-help" aria-label="结算模式说明">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <el-select v-model="taskForm.settlementType" class="w-full">
                  <el-option
                    v-for="option in settlementTypeOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </el-form-item>

              <el-form-item v-if="taskDialogParent && String(taskDialogParent.type) !== '3'" label="是否同步时长到父任务" prop="inheritParentTime">
                <el-switch
                  v-model="taskForm.inheritParentTime"
                  active-text="同步"
                  inactive-text="不计入"
                />
              </el-form-item>
            </div>
          </template>
        </el-form>

        <template #footer>
          <div class="task-dialog-footer">
            <el-button @click="taskDialogVisible = false">关闭</el-button>
            <template v-if="taskDialogMode === 'view'">
              <!-- only close -->
            </template>
            <template v-else>
              <template v-if="isSceneDialog">
                <el-button type="warning" :loading="taskDialogLoading" @click="submitTaskDialog">保存</el-button>
              </template>
              <template v-else>
                <el-button v-if="taskDialogStep > 0" @click="taskDialogStep -= 1">上一步</el-button>
                <el-button v-if="taskDialogStep === 0" type="warning" @click="goTaskDialogNext">下一步</el-button>
                <el-button v-else type="warning" :loading="taskDialogLoading" @click="submitTaskDialog">保存</el-button>
              </template>
            </template>
          </div>
        </template>
      </el-dialog>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { Calendar, Clock, Document, Folder, Plus, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import {
  createTaskApi,
  deleteTaskApi,
  heartbeatApi,
  getAllTasksApi,
  updateTaskApi,
  toggleActiveApi,
  toggleCompleteApi,
  toggleRunStatusApi,
  type TaskItem,
} from '@/api/task';
import { editReviewApi, getAllReviewsApi, type ReviewItem } from '@/api/review';
import { getTaskLogsByDateApi, type TaskLogItem } from '@/api/taskLog';

type SectionKey = 'today' | 'todo' | 'all' | 'review';
type RecurrenceMode = 'interval' | 'weekly' | 'monthly';

interface TreeTask extends TaskItem {
  children?: TreeTask[];
}

interface ParsedCronConfig {
  cycleMode: RecurrenceMode;
  cycleIntervalDays: number;
  cycleWeekdays: number[];
  cycleMonthDays: number[];
}

interface CycleFieldValues {
  cycleIntervalDays: number;
  cycleWeekdays: number[];
  cycleMonthDays: number[];
}

interface RecurringTaskDraft extends CycleFieldValues {
  cycleMode: RecurrenceMode;
  planDurationHours: number;
  planDurationMinutes: number;
  settlementType: number;
  startTime: string;
  endTime: string;
}

interface TaskDialogForm {
  taskId: number | null;
  parentId: number | null;
  title: string;
  description: string;
  createTime: string;
  type: number;
  settlementType: number;
  targetDuration: number;
  planDurationHours: number;
  planDurationMinutes: number;
  startTime: string;
  endTime: string;
  cycleMode: RecurrenceMode;
  cycleIntervalDays: number;
  cycleWeekdays: number[];
  cycleMonthDays: number[];
  inheritParentTime: boolean;
  active: boolean;
  isCompleted: boolean;
}

const router = useRouter();
const authStore = useAuthStore();

const activeSection = ref<SectionKey>('today');
const loadingTasks = ref(false);
const savingReview = ref(false);
const heartbeatNow = ref(Date.now());
const heartbeatSyncing = ref(false);
const taskDialogVisible = ref(false);
const taskDialogStep = ref(0);
const taskDialogMode = ref<'create' | 'edit' | 'view'>('create');
const taskDialogLoading = ref(false);
const taskDialogParent = ref<TaskItem | null>(null);
const taskFormRef = ref<FormInstance>();
const allTasks = ref<TaskItem[]>([]);
const reviewHistory = ref<ReviewItem[]>([]);
const selectedReviewId = ref<number | null>(null);
const reviewDraft = ref('');
const recurringTaskDraft = ref<RecurringTaskDraft | null>(null);
const taskLogs = ref<TaskLogItem[]>([]);
const loadingTaskLogs = ref(false);
const taskLogDetailVisible = ref(false);
const selectedTaskLog = ref<TaskLogItem | null>(null);

const taskTypeOptions: Array<{ label: string; value: number }> = [
  { label: '随手记', value: 0 },
  { label: '周期任务', value: 1 },
  { label: 'DDL', value: 2 },
];

const recurringDefaultTime = '04:00:00';
const HEARTBEAT_INTERVAL_MS = 60_000;

let heartbeatTimer: number | null = null;

const cycleModeOptions: Array<{ label: string; value: RecurrenceMode }> = [
  { label: '每几天执行一次', value: 'interval' as const },
  { label: '每周指定星期', value: 'weekly' as const },
  { label: '每月指定日期', value: 'monthly' as const },
];

const weekdayOptions: Array<{ label: string; value: number }> = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];

const monthDayOptions: Array<{ label: string; value: number }> = Array.from({ length: 31 }, (_, index) => ({
  label: `${index + 1}号`,
  value: index + 1,
}));

const weekdayNameMap: Record<number, string> = {
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
  7: 'SUN',
};

const weekdayTokenMap: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
};

const settlementTypeOptions: Array<{ label: string; value: number }> = [
  { label: '手动结算', value: 0 },
  { label: '自动结算', value: 1 },
];

const normalizeNumberList = (values: number[]) => Array.from(new Set(values)).sort((left, right) => left - right);

const parseHeartbeatTime = (value?: string) => {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const localRunStatus = ref<Record<number, string>>({});

const getRunStatusKey = (task: TaskItem) => {
  const local = localRunStatus.value[task.taskId];
  return local ?? String(task.runStatus ?? 0);
};

const getRunStatusHasLastStart = (task: TaskItem) => {
  // 覆写表中有该任务 key 说明被乐观更新过，视为有 lastStartTime
  if (localRunStatus.value[task.taskId] !== undefined) return true;
  return !!task.lastStartTime;
};

const isHeartbeatTask = (task: TaskItem) => getRunStatusKey(task) === '1' && getRunStatusHasLastStart(task) && !task.isCompleted;

const nextRunStatus = (task: TaskItem): 'IN_PROGRESS' | 'PAUSED' => (isHeartbeatTask(task) ? 'PAUSED' : 'IN_PROGRESS');

const liveActual = (task: TaskItem) => {
  const base = Number(task.actualDuration ?? 0);
  if (!isHeartbeatTask(task)) return base;
  const start = parseHeartbeatTime(task.lastStartTime);
  if (!start) return base;
  const elapsed = Math.max(0, Math.floor((heartbeatNow.value - start.getTime()) / 1000));
  return base + elapsed;
};

const progressPercent = (task: TaskItem) => {
  const target = Number(task.targetDuration ?? 0);
  if (target <= 0) return 0;
  return Math.min(100, Math.round((liveActual(task) / target) * 100));
};

const formatDurationHMS = (seconds?: number) => {
  const value = Math.max(0, Number(seconds ?? 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const clockLabel = (task: TaskItem) => {
  const actual = formatDurationHMS(liveActual(task));
  const target = Number(task.targetDuration ?? 0) > 0 ? formatDurationHMS(task.targetDuration) : '--:--:--';
  return `${actual} / ${target}`;
};

const startHeartbeatTimer = () => {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(() => {
    heartbeatNow.value = Date.now();
    if (heartbeatSyncing.value) return;

    const runningTasks = allTasks.value.filter(isHeartbeatTask);
    const dueTasks = runningTasks.filter((task) => {
      const start = parseHeartbeatTime(task.lastStartTime);
      if (!start) return false;
      return heartbeatNow.value - start.getTime() >= HEARTBEAT_INTERVAL_MS;
    });

    if (!dueTasks.length) return;

    heartbeatSyncing.value = true;
    void Promise.all(
      dueTasks.map((task) =>
        heartbeatApi(task.taskId).catch(() => {})
      ),
    ).finally(async () => {
      await loadTasks();
      heartbeatSyncing.value = false;
    });
  }, 1000);
};

const stopHeartbeatTimer = () => {
  if (heartbeatTimer === null) return;
  window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

const getTodayDatePart = () => {
  const now = new Date();
  const pad = (num: number) => `${num}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const combineDateWithTime = (timeValue?: string) => {
  if (!timeValue) return '';
  return `${getTodayDatePart()} ${timeValue}`;
};

const parseCronConfig = (cron?: string): ParsedCronConfig | null => {
  if (!cron) return null;

  const compact = cron.trim().toUpperCase();
  const intervalMatch = /^DAY_INTERVAL\|(\d+)\|([0-9T:-]+)$/.exec(compact);
  if (intervalMatch) {
    return {
      cycleMode: 'interval',
      cycleIntervalDays: Math.max(1, Number(intervalMatch[1]) || 1),
      cycleWeekdays: [],
      cycleMonthDays: [],
    };
  }

  const weeklyMatch = /^0\s+(\d+)\s+(\d+)\s+\?\s+\*\s+([A-Z,\-]+)$/.exec(compact);
  if (weeklyMatch) {
    const tokens = weeklyMatch[3].split(',').flatMap((token) => token.split('-'));
    const cycleWeekdays = normalizeNumberList(
      tokens
        .map((token) => weekdayTokenMap[token.trim()])
        .filter((value): value is number => Number.isFinite(value)),
    );
    if (cycleWeekdays.length > 0) {
      return {
        cycleMode: 'weekly',
        cycleIntervalDays: 1,
        cycleWeekdays,
        cycleMonthDays: [],
      };
    }
  }

  const monthlyMatch = /^0\s+(\d+)\s+(\d+)\s+([0-9,]+)\s+\*\s+\?$/.exec(compact);
  if (monthlyMatch) {
    const cycleMonthDays = normalizeNumberList(
      monthlyMatch[3]
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 31),
    );
    if (cycleMonthDays.length > 0) {
      return {
        cycleMode: 'monthly',
        cycleIntervalDays: 1,
        cycleWeekdays: [],
        cycleMonthDays,
      };
    }
  }

  const legacyDayMatch = /^0\s+\d+\s+\d+\s+1\/(\d+)\s+\*\s+\?$/.exec(compact);
  if (legacyDayMatch) {
    return {
      cycleMode: 'interval',
      cycleIntervalDays: Math.max(1, Number(legacyDayMatch[1]) || 1),
      cycleWeekdays: [],
      cycleMonthDays: [],
    };
  }

  const legacyWeekMatch = /^0\s+\d+\s+\d+\s+\?\s+\*\s+([A-Z]{3})\/(\d+)$/.exec(compact);
  if (legacyWeekMatch) {
    const weekday = weekdayTokenMap[legacyWeekMatch[1]];
    return {
      cycleMode: 'weekly',
      cycleIntervalDays: Math.max(1, Number(legacyWeekMatch[2]) || 1),
      cycleWeekdays: weekday ? [weekday] : [],
      cycleMonthDays: [],
    };
  }

  const legacyMonthMatch = /^0\s+\d+\s+\d+\s+(\d+)\s+1\/(\d+)\s+\?$/.exec(compact);
  if (legacyMonthMatch) {
    return {
      cycleMode: 'monthly',
      cycleIntervalDays: Math.max(1, Number(legacyMonthMatch[2]) || 1),
      cycleWeekdays: [],
      cycleMonthDays: [Math.max(1, Number(legacyMonthMatch[1]) || 1)],
    };
  }

  return null;
};

const createRecurringTimeValue = (dateValue?: string) => {
  if (!dateValue) return '';
  return combineDateWithTime(dateValue);
};

const normalizeCycleValues = (mode: RecurrenceMode, form: CycleFieldValues) => {
  if (mode === 'interval') {
    return `interval:${Math.max(1, Number(form.cycleIntervalDays || 1))}`;
  }

  if (mode === 'weekly') {
    return `weekly:${normalizeNumberList(form.cycleWeekdays).map((value) => weekdayNameMap[value]).filter(Boolean).join(',')}`;
  }

  return `monthly:${normalizeNumberList(form.cycleMonthDays).join(',')}`;
};

const normalizeParsedCycleValues = (mode: RecurrenceMode, parsed: ParsedCronConfig) => {
  if (mode === 'interval') {
    return `interval:${Math.max(1, Number(parsed.cycleIntervalDays || 1))}`;
  }

  if (mode === 'weekly') {
    return `weekly:${normalizeNumberList(parsed.cycleWeekdays).map((value) => weekdayNameMap[value]).filter(Boolean).join(',')}`;
  }

  return `monthly:${normalizeNumberList(parsed.cycleMonthDays).join(',')}`;
};

const getCurrentCycleSignature = () => normalizeCycleValues(taskForm.cycleMode, {
  cycleIntervalDays: taskForm.cycleIntervalDays,
  cycleWeekdays: taskForm.cycleWeekdays,
  cycleMonthDays: taskForm.cycleMonthDays,
});

const getParsedCycleSignature = (cron?: string) => {
  const parsed = parseCronConfig(cron);
  if (!parsed) return '';
  return normalizeParsedCycleValues(parsed.cycleMode, parsed);
};

const createDefaultTaskForm = (
  parentTask?: TaskItem | null,
  sourceTask?: TaskItem | null,
  presetType?: number | null,
  defaultActive = true,
): TaskDialogForm => {
  const parentType = parentTask ? String(parentTask.type ?? '') : '';
  const inheritedType = parentType === '3' ? 0 : Number(parentType || 0);
  const sourceType = sourceTask ? Number(sourceTask.type ?? inheritedType ?? 0) : inheritedType;
  const requestedType = Number(presetType ?? sourceType);
  const normalizedType = Number.isFinite(requestedType) ? requestedType : 0;
  const sourceSettlement = sourceTask ? Number(sourceTask.settlementType ?? 0) : Number(parentTask?.settlementType ?? 0);
  const parsedCron = parseCronConfig(sourceTask?.cronConfig ?? parentTask?.cronConfig);
  const sourceDurationSeconds = sourceTask?.targetDuration ?? parentTask?.targetDuration ?? 0;
  const totalMinutes = Math.max(0, Math.round(sourceDurationSeconds / 60));
  const resolveDefaultDateTime = (value?: string) => {
    if (!value) return '';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '';

    return normalizedType === 1 ? getTimePart(value) : formatDateTimeForPicker(value);
  };

  // 创建子任务时默认继承父任务的起止时间；编辑/复制（存在 sourceTask）时使用 sourceTask 的时间
  // 如果用户手动清空起止时间，表单会保留空值
  const defaultStartTime = sourceTask?.startTime
    ? resolveDefaultDateTime(sourceTask.startTime)
    : (parentTask ? (parentTask.startTime ? resolveDefaultDateTime(parentTask.startTime) : '') : '');

  const defaultEndTime = sourceTask?.endTime
    ? resolveDefaultDateTime(sourceTask.endTime)
    : (parentTask ? (parentTask.endTime ? resolveDefaultDateTime(parentTask.endTime) : '') : '');

  const form: TaskDialogForm = {
    taskId: sourceTask?.taskId ?? null,
    parentId: sourceTask ? (sourceTask.parentId ?? null) : (parentTask?.taskId ?? null),
    title: sourceTask?.title ?? '',
    description: sourceTask?.description ?? '',
    createTime: sourceTask?.createTime ?? '',
    type: normalizedType,
    settlementType: Number.isFinite(sourceSettlement) ? sourceSettlement : 0,
    targetDuration: sourceTask?.targetDuration ?? parentTask?.targetDuration ?? 0,
    planDurationHours: Math.floor(totalMinutes / 60),
    planDurationMinutes: totalMinutes % 60,
    startTime: defaultStartTime,
    endTime: defaultEndTime,
    cycleMode: parsedCron?.cycleMode ?? 'interval',
    cycleIntervalDays: parsedCron?.cycleIntervalDays ?? 1,
    cycleWeekdays: parsedCron?.cycleWeekdays ?? [],
    cycleMonthDays: parsedCron?.cycleMonthDays ?? [],
    inheritParentTime: sourceTask?.inheritParentTime ?? (parentTask && String(parentTask.type) !== '3' ? true : false),
    active: sourceTask?.active ?? defaultActive,
    isCompleted: sourceTask?.isCompleted ?? false,
  };

  return form;
};

const snapshotRecurringDraft = (): RecurringTaskDraft => ({
  cycleMode: taskForm.cycleMode,
  cycleIntervalDays: taskForm.cycleIntervalDays,
  cycleWeekdays: [...taskForm.cycleWeekdays],
  cycleMonthDays: [...taskForm.cycleMonthDays],
  planDurationHours: taskForm.planDurationHours,
  planDurationMinutes: taskForm.planDurationMinutes,
  settlementType: taskForm.settlementType,
  startTime: taskForm.startTime,
  endTime: taskForm.endTime,
});

const restoreRecurringDraft = (draft: RecurringTaskDraft) => {
  taskForm.cycleMode = draft.cycleMode;
  taskForm.cycleIntervalDays = draft.cycleIntervalDays;
  taskForm.cycleWeekdays = [...draft.cycleWeekdays];
  taskForm.cycleMonthDays = [...draft.cycleMonthDays];
  taskForm.planDurationHours = draft.planDurationHours;
  taskForm.planDurationMinutes = draft.planDurationMinutes;
  taskForm.settlementType = draft.settlementType;
  taskForm.startTime = draft.startTime;
  taskForm.endTime = draft.endTime;
};

const taskForm = reactive<TaskDialogForm>(createDefaultTaskForm());

const displayUsername = computed(() => authStore.username || '未命名用户');
const isRecurringTask = computed(() => String(taskForm.type) === '1');
const taskDialogTitle = computed(() => {
  if (taskDialogMode.value === 'view') return taskForm.title || '任务详情';
  if (taskDialogMode.value === 'edit') return '编辑任务';
  if (taskForm.type === 3) return '新建场景';
  if (taskDialogParent.value && String(taskDialogParent.value.type) === '3') return '新建任务';
  return taskDialogParent.value ? '新建子任务' : '新建任务';
});

const taskDialogWarnings = computed(() => {
  const warnings: string[] = [];
  const parent = taskDialogParent.value;
  if (!parent) return warnings;

  const parentType = String(parent.type ?? '');
  const childType = String(taskForm.type ?? '');

  if (parentType === '2' && childType === '1') {
    warnings.push('父任务已过期，是否继续当前周期任务？');
  }

  if (parentType === '1' && childType === '1' && parent.cronConfig) {
    if (getParsedCycleSignature(parent.cronConfig) !== getCurrentCycleSignature()) {
      warnings.push('父子任务的重复周期不一致，子任务将独立进行。');
    }
  }

  // 场景下的子任务不提示类型不一致
  if (parentType !== childType && warnings.length === 0 && parentType !== '3') {
    warnings.push(`父任务是${taskTypeLabel(parentType)}，当前子任务是${taskTypeLabel(childType)}，子任务将独立进行。`);
  }

  return Array.from(new Set(warnings));
});

const validateRecurringIntervalDays = (_rule: unknown, _value: unknown, callback: (error?: string | Error) => void) => {
  if (taskForm.cycleMode !== 'interval') {
    callback();
    return;
  }

  if (Number(taskForm.cycleIntervalDays || 0) < 1) {
    callback(new Error('请输入每几天执行一次'));
    return;
  }

  callback();
};

const validateRecurringWeekdays = (_rule: unknown, _value: unknown, callback: (error?: string | Error) => void) => {
  if (taskForm.cycleMode !== 'weekly') {
    callback();
    return;
  }

  if (!taskForm.cycleWeekdays.length) {
    callback(new Error('请选择每周执行的星期'));
    return;
  }

  callback();
};

const validateRecurringMonthDays = (_rule: unknown, _value: unknown, callback: (error?: string | Error) => void) => {
  if (taskForm.cycleMode !== 'monthly') {
    callback();
    return;
  }

  if (!taskForm.cycleMonthDays.length) {
    callback(new Error('请选择每月执行的日期'));
    return;
  }

  callback();
};

const taskFormRules = computed<FormRules>(() => {
  const rules: FormRules = {
    title: [{ required: true, message: '请输入任务标题', trigger: 'blur' }],
  };

  if (String(taskForm.type) === '1') {
    rules.planDurationHours = [{ required: true, message: '周期任务需要填写计划用时', trigger: 'change' }];
    rules.planDurationMinutes = [{ required: true, message: '周期任务需要填写计划用时', trigger: 'change' }];
    rules.cycleMode = [{ required: true, message: '周期任务需要选择循环尺度', trigger: 'change' }];
    rules.cycleIntervalDays = [{ validator: validateRecurringIntervalDays, trigger: 'change' }];
    rules.cycleWeekdays = [{ validator: validateRecurringWeekdays, trigger: 'change' }];
    rules.cycleMonthDays = [{ validator: validateRecurringMonthDays, trigger: 'change' }];
  }

  if (String(taskForm.type) === '2') {
    rules.endTime = [{ required: true, message: 'DDL任务需要填写完成时间', trigger: 'change' }];
  }

  return rules;
});

watch(
  () => taskForm.type,
  (type, previousType) => {
    if (String(previousType) === '1' && String(type) !== '1') {
      recurringTaskDraft.value = snapshotRecurringDraft();
    }

    if (String(type) === '0') {
      taskForm.settlementType = 0;
    }

    if (String(type) !== '1') {
      taskForm.cycleMode = 'interval';
      taskForm.cycleIntervalDays = 1;
      taskForm.cycleWeekdays = [];
      taskForm.cycleMonthDays = [];
      return;
    }

    if (String(previousType) !== '1' && recurringTaskDraft.value) {
      restoreRecurringDraft(recurringTaskDraft.value);
    }
  },
);

const treeProps = {
  children: 'children',
  label: 'title',
};

const sectionMeta = {
  today: { label: '今日任务', badge: 'TODAY FOCUS', description: '完成时间在今日且仍处于激活中的任务。' },
  todo: { label: '待办任务', badge: 'TODO LIST', description: '未完成且激活的任务，按今日和后续分组。' },
  all: { label: '全部任务', badge: 'ALL TASKS', description: '' },
  review: { label: '历史回顾', badge: 'DAILY REVIEW', description: '今日总结草稿 + 历史 review 详情。' },
} as const;

const todayKey = computed(() => formatBusinessDateKey(new Date()));
const draftStorageKey = computed(() => `mychecklist-review-draft-${todayKey.value}`);

const todayLabel = computed(() => {
  const date = getBusinessDayDate(new Date());
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
});

const sectionItems = computed<Array<{ key: SectionKey; label: string; countLabel: string }>>(() => {
  const items: Array<{ key: SectionKey; label: string; countLabel: string }> = [
    { key: 'today', label: sectionMeta.today.label, countLabel: `${countTree(currentTodayTree.value)} 项` },
    { key: 'todo', label: sectionMeta.todo.label, countLabel: `${countTree(currentTodoTree.value)} 项` },
    { key: 'all', label: sectionMeta.all.label, countLabel: `${countTree(currentAllTree.value)} 项` },
    { key: 'review', label: sectionMeta.review.label, countLabel: `${reviewHistory.value.length} 条` },
  ];
  return items;
});

const setActiveSection = (key: string) => {
  if (key === 'today' || key === 'todo' || key === 'all' || key === 'review') {
    activeSection.value = key;
  }
};

const activeSectionTitle = computed(() => sectionMeta[activeSection.value].label);
const activeSectionBadge = computed(() => sectionMeta[activeSection.value].badge);
const isSceneDialog = computed(() => (taskDialogMode.value === 'create' || taskDialogMode.value === 'edit') && String(taskForm.type) === '3');

const currentAllTree = computed(() => buildTree(allTasks.value));
const sceneTaskTree = computed(() => filterSceneTree(currentAllTree.value));
const nonSceneTaskTree = computed(() => filterNonSceneTree(currentAllTree.value));
const currentTodayTree = computed(() => filterTree(currentAllTree.value, isTodayTask));
const currentTodoTree = computed(() => filterTree(currentAllTree.value, isTodoTask));
const currentTodoTodayTree = computed(() => filterTree(currentAllTree.value, isTodoTodayTask));
const currentTodoFutureTree = computed(() => filterTree(currentAllTree.value, isTodoFutureTask));
const currentTaskTree = computed(() => {
  if (activeSection.value === 'today') return currentTodayTree.value;
  if (activeSection.value === 'todo') return currentTodoTree.value;
  return currentAllTree.value;
});

const selectedReview = computed(() => reviewHistory.value.find((item) => item.reviewId === selectedReviewId.value) ?? null);

const timeDistHeatmapRows = computed(() => {
  const review = selectedReview.value;
  if (!review?.timeDistribution) return [];

  let segments: Array<[number, number]>;
  try {
    segments = JSON.parse(review.timeDistribution);
  } catch {
    return [];
  }

  if (!Array.isArray(segments) || segments.length === 0) return [];

  const totalSeconds = 24 * 3600; // 86400
  const bucketMinutes = 10;
  const bucketSize = bucketMinutes * 60; // 600 秒
  const bucketsPerRow = (60 / bucketMinutes) * 4; // 每行 4 小时 = 24 格
  const rowCount = 6;
  const bucketCount = rowCount * bucketsPerRow; // 144 格
  const dayStartOffset = 4 * 3600; // 凌晨 4:00 为起点

  const activeSet = new Set<number>();
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    let [start, end] = [Number(seg[0]), Number(seg[1])];
    if (isNaN(start) || isNaN(end)) continue;
    // 数据以 4:00 为 0，对齐 buckets
    const clampedEnd = Math.min(end, totalSeconds);
    const clampedStart = Math.max(0, start);
    if (clampedStart >= clampedEnd) continue;
    const firstBucket = Math.floor(clampedStart / bucketSize);
    const lastBucket = Math.min(Math.floor((clampedEnd - 1) / bucketSize), bucketCount - 1);
    for (let b = firstBucket; b <= lastBucket; b++) {
      activeSet.add(b);
    }
  }

  const rows: Array<Array<{ active: boolean; label: string }>> = [];
  for (let r = 0; r < rowCount; r++) {
    const row: Array<{ active: boolean; label: string }> = [];
    for (let c = 0; c < bucketsPerRow; c++) {
      const idx = r * bucketsPerRow + c;
      const segStart = (idx * bucketSize + dayStartOffset) % totalSeconds;
      const h = Math.floor(segStart / 3600);
      const m = Math.floor((segStart % 3600) / 60);
      row.push({
        active: activeSet.has(idx),
        label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      });
    }
    rows.push(row);
  }

  return rows;
});

const heatmapRowRange = (rowIdx: number) => {
  const startHour = (4 + rowIdx * 4) % 24;
  const endHour = (startHour + 4) % 24;
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(startHour)}:00-${pad(endHour)}:00`;
};

const resetTaskDialog = () => {
  Object.assign(taskForm, createDefaultTaskForm());
  taskDialogStep.value = 0;
  taskDialogMode.value = 'create';
  taskDialogParent.value = null;
  taskDialogLoading.value = false;
  recurringTaskDraft.value = null;
  taskFormRef.value?.clearValidate();
};

const findTaskById = (taskId: number | null | undefined) => {
  if (taskId == null) return null;
  return allTasks.value.find((task) => task.taskId === taskId) ?? null;
};

const openCreateTaskDialog = (parentTask?: TaskItem | null, defaultActive = true) => {
  taskDialogMode.value = 'create';
  taskDialogParent.value = parentTask ?? null;
  Object.assign(taskForm, createDefaultTaskForm(parentTask ?? null, null, undefined, defaultActive));
  recurringTaskDraft.value = String(taskForm.type) === '1' ? snapshotRecurringDraft() : null;
  taskDialogStep.value = 0;
  taskDialogVisible.value = true;
};

const openCreateSceneDialog = () => {
  taskDialogMode.value = 'create';
  taskDialogParent.value = null;
  Object.assign(taskForm, createDefaultTaskForm(null, null, 3, true));
  recurringTaskDraft.value = null;
  taskDialogStep.value = 0;
  taskDialogVisible.value = true;
};

const openEditTaskDialog = (task: TaskItem) => {
  taskDialogMode.value = 'edit';
  taskDialogParent.value = findTaskById(task.parentId);
  Object.assign(taskForm, createDefaultTaskForm(taskDialogParent.value, task));
  recurringTaskDraft.value = String(taskForm.type) === '1' ? snapshotRecurringDraft() : null;
  taskDialogStep.value = 0;
  taskDialogVisible.value = true;
};

const openViewTaskDialog = (task: TaskItem) => {
  taskDialogMode.value = 'view';
  taskDialogParent.value = findTaskById(task.parentId);
  Object.assign(taskForm, createDefaultTaskForm(taskDialogParent.value, task));
  recurringTaskDraft.value = String(taskForm.type) === '1' ? snapshotRecurringDraft() : null;
  taskDialogStep.value = 0;
  taskDialogVisible.value = true;
};

const goTaskDialogNext = async () => {
  if (!taskFormRef.value) {
    taskDialogStep.value = 1;
    return;
  }

  try {
    await taskFormRef.value.validateField('title');
    taskDialogStep.value = 1;
  } catch {
    // 校验提示由表单自身展示
  }
};

const buildCronConfig = () => {
  if (String(taskForm.type) !== '1') return undefined;
  const recurringTime = getTimePart(taskForm.startTime) || recurringDefaultTime;
  const [hour, minute] = recurringTime.split(':');
  const anchor = taskForm.startTime
    ? (taskForm.startTime.includes('T') || taskForm.startTime.includes(' ') ? taskForm.startTime.replace(' ', 'T') : `${getTodayDatePart()}T${recurringTime}`)
    : `${getTodayDatePart()}T${recurringDefaultTime}`;

  if (taskForm.cycleMode === 'interval') {
    return anchor ? `DAY_INTERVAL|${Math.max(1, Number(taskForm.cycleIntervalDays || 1))}|${anchor}` : undefined;
  }

  if (taskForm.cycleMode === 'weekly') {
    const days = normalizeNumberList(taskForm.cycleWeekdays).map((value) => weekdayNameMap[value]).filter(Boolean);
    return days.length ? `0 ${minute} ${hour} ? * ${days.join(',')}` : undefined;
  }

  const days = normalizeNumberList(taskForm.cycleMonthDays).filter((value) => value >= 1 && value <= 31);
  return days.length ? `0 ${minute} ${hour} ${days.join(',')} * ?` : undefined;
};

const buildTaskPayload = () => {
  const totalDurationSeconds = Math.max(0, (Number(taskForm.planDurationHours || 0) * 3600) + (Number(taskForm.planDurationMinutes || 0) * 60));
  const normalizeDateTimeForApi = (value?: string) => {
    if (!value) return null;
    return value.includes('T') ? value : value.replace(' ', 'T');
  };
  const normalizeRecurringDateTimeForApi = (value?: string) => {
    if (!value) return null;
    if (value.includes('T')) return value;
    if (value.includes(' ')) return value.replace(' ', 'T');
    return `${getTodayDatePart()}T${value.length === 5 ? `${value}:00` : value}`;
  };

  const payload: Record<string, unknown> = {
    taskId: taskForm.taskId ?? null,
    parentId: taskForm.parentId ?? null,
    title: taskForm.title.trim(),
    description: taskForm.description.trim() || null,
    type: String(taskForm.type),
    settlementType: String(taskForm.settlementType),
    targetDuration: totalDurationSeconds,
    startTime: String(taskForm.type) === '1' ? normalizeRecurringDateTimeForApi(taskForm.startTime) : normalizeDateTimeForApi(taskForm.startTime),
    endTime: String(taskForm.type) === '1' ? normalizeRecurringDateTimeForApi(taskForm.endTime) : normalizeDateTimeForApi(taskForm.endTime),
    cronConfig: buildCronConfig() ?? null,
    inheritParentTime: taskDialogParent.value ? taskForm.inheritParentTime : null,
    active: taskForm.active,
    isCompleted: taskForm.isCompleted,
  };

  return payload;
};

const submitTaskDialog = async () => {
  if (!taskFormRef.value) return;

  try {
    await taskFormRef.value.validate();
  } catch {
    return;
  }
  // 验证：如果同时填写了起止时间，确保结束时间不早于开始时间
  const parseForCompare = (value?: string, isRecurring = false) => {
    if (!value) return null;
    if (value.includes('T')) return new Date(value.replace(' ', 'T'));
    if (value.includes(' ')) return new Date(value.replace(' ', 'T'));
    if (isRecurring) {
      const time = value.length === 5 ? `${value}:00` : value;
      return new Date(`${getTodayDatePart()}T${time}`);
    }
    return new Date(value);
  };

  const start = parseForCompare(taskForm.startTime, String(taskForm.type) === '1');
  const end = parseForCompare(taskForm.endTime, String(taskForm.type) === '1');
  if (start && end && end.getTime() < start.getTime()) {
    ElMessage.error('结束时间不能早于开始时间，请检查起止时间');
    return;
  }

  taskDialogLoading.value = true;
  try {
    const payload = buildTaskPayload();
    const response = taskDialogMode.value === 'edit'
      ? await updateTaskApi(payload)
      : await createTaskApi(payload);
    ElMessage.success(response.data || (taskDialogMode.value === 'edit' ? '任务已更新' : '任务已创建'));
    taskDialogVisible.value = false;
    await loadTasks();
  } catch {
    // 具体错误由全局拦截器提示；这里吞掉异常避免事件处理器抛出未处理 promise
  } finally {
    taskDialogLoading.value = false;
  }
};

const deleteTask = async (task: TaskItem) => {
  try {
    await ElMessageBox.confirm(`确认删除任务「${task.title}」及其所有子任务吗？`, '删除任务', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }

  await deleteTaskApi(task.taskId);
  ElMessage.success('任务已删除');
  await loadTasks();
};

const loadTasks = async () => {
  loadingTasks.value = true;
  try {
    const response = await getAllTasksApi();
    allTasks.value = response.data || [];
    localRunStatus.value = {};
    heartbeatNow.value = Date.now();
  } finally {
    loadingTasks.value = false;
  }
};

const loadReviews = async () => {
  const response = await getAllReviewsApi();
  reviewHistory.value = [...(response.data || [])].sort((left, right) => right.date.localeCompare(left.date));

  const todayReview = reviewHistory.value.find((item) => formatDateKey(item.date) === todayKey.value);
  if (todayReview) {
    selectedReviewId.value = todayReview.reviewId;
  } else if (!selectedReviewId.value && reviewHistory.value.length) {
    selectedReviewId.value = reviewHistory.value[0].reviewId;
  }

  const storedDraft = window.localStorage.getItem(draftStorageKey.value);
  if (storedDraft !== null) {
    reviewDraft.value = storedDraft;
  } else if (todayReview?.content) {
    reviewDraft.value = todayReview.content;
  }
};

const syncReviewDraft = () => {
  window.localStorage.setItem(draftStorageKey.value, reviewDraft.value);
};

const saveDraft = () => {
  syncReviewDraft();
  ElMessage.success('草稿已保存在本地浏览器');
};

const saveReviewToServer = async () => {
  savingReview.value = true;
  try {
    await editReviewApi(todayKey.value, reviewDraft.value);
    syncReviewDraft();
    ElMessage.success('今日总结已保存');
    await loadReviews();
  } finally {
    savingReview.value = false;
  }
};

const selectReview = (review: ReviewItem) => {
  selectedReviewId.value = review.reviewId;
  loadTaskLogsForReview(review);
};

const loadTaskLogsForReview = async (review: ReviewItem) => {
  taskLogs.value = [];
  loadingTaskLogs.value = true;
  try {
    const dateKey = formatDateKey(review.date);
    const response = await getTaskLogsByDateApi(dateKey);
    taskLogs.value = response.data || [];
  } catch {
    taskLogs.value = [];
  } finally {
    loadingTaskLogs.value = false;
  }
};

const openTaskLogDetail = (logItem: TaskLogItem) => {
  selectedTaskLog.value = logItem;
  taskLogDetailVisible.value = true;
};

const resultStatusLabel = (status?: number) => {
  switch (status) {
    case 0: return '未开始';
    case 1: return '未完成';
    case 2: return '完成';
    case 3: return '超时完成';
    case 4: return '暂不要求';
    default: return '-';
  }
};

const resultStatusClass = (status?: number) => {
  switch (status) {
    case 0: return 'status-unstarted';
    case 1: return 'status-incomplete';
    case 2: return 'status-completed';
    case 3: return 'status-late';
    case 4: return 'status-deferred';
    default: return '';
  }
};

const handleLogout = async () => {
  authStore.logout();
  await router.push('/login');
};

const toggleActive = async (task: TreeTask) => {
  const prevActive = !!task.active;
  const newActive = !prevActive;
  // 乐观更新树节点副本
  task.active = newActive;
  try {
    await toggleActiveApi(task.taskId, newActive);
    // 递归同步本地 allTasks 中该节点及其所有子孙的 active 状态
    const targetRaw = allTasks.value.find((t) => t.taskId === task.taskId);
    if (targetRaw) targetRaw.active = newActive;
    cascadeActiveLocal(task.taskId, newActive);
    // 强制重建数组引用，触发所有 computed 树重新计算
    allTasks.value = [...allTasks.value];
    ElMessage.success('任务状态已更新');
  } catch {
    task.active = prevActive;
  }
};

/** 递归更新本地 allTasks 中指定节点及其所有子孙的 active */
const cascadeActiveLocal = (parentId: number, active: boolean) => {
  allTasks.value.forEach((t) => {
    if (t.parentId === parentId) {
      t.active = active;
      cascadeActiveLocal(t.taskId, active);
    }
  });
};

const toggleComplete = async (task: TreeTask) => {
  const prevCompleted = !!task.isCompleted;
  const newCompleted = !prevCompleted;
  task.isCompleted = newCompleted;
  try {
    await toggleCompleteApi(task.taskId, newCompleted);
    // 同步 allTasks 中原对象
    const targetRaw = allTasks.value.find((t) => t.taskId === task.taskId);
    if (targetRaw) {
      targetRaw.isCompleted = newCompleted;
      if (newCompleted) targetRaw.runStatus = '0';
    }
    if (newCompleted) {
      // 完成：向下级联完成所有子任务
      cascadeCompleteDownLocal(task.taskId);
    } else {
      // 撤回：只向上一级撤回父任务（后端 cancelParentComplete 只撤父不撤子）
      uncompleteParentLocal(task.parentId);
    }
    allTasks.value = [...allTasks.value];
    ElMessage.success('完成状态已更新');
  } catch {
    task.isCompleted = prevCompleted;
  }
};

/** 完成：向下递归完成所有子任务 */
const cascadeCompleteDownLocal = (parentId: number) => {
  allTasks.value.forEach((t) => {
    if (t.parentId === parentId) {
      t.isCompleted = true;
      t.runStatus = '0';
      cascadeCompleteDownLocal(t.taskId);
    }
  });
};

/** 撤回：向上递归撤回父任务 */
const uncompleteParentLocal = (parentId: number | null | undefined) => {
  if (parentId == null || parentId === 0) return;
  const parent = allTasks.value.find((t) => t.taskId === parentId);
  if (!parent || !parent.isCompleted) return;
  parent.isCompleted = false;
  uncompleteParentLocal(parent.parentId);
};

const toggleRunStatus = async (task: TreeTask) => {
  const targetStatus = nextRunStatus(task);
  const prevRunStatus = String(task.runStatus ?? '0');
  const prevLastStart = task.lastStartTime;
  const prevActual = task.actualDuration;
  const settledActual = liveActual(task); // 暂停前先记下实时值

  // 软约束：启动任务时如果存在时长同步冲突，弹窗提醒
  if (targetStatus === 'IN_PROGRESS') {
    // 1. 该任务下是否存在真正在运行且同步的子任务（有 lastStartTime 才算运行）
    const runningInheritedChildren = allTasks.value.filter(
      (t) => t.parentId === task.taskId
        && getRunStatusKey(t) === '1'
        && !!t.lastStartTime
        && Boolean(t.inheritParentTime),
    );
    // 2. 该任务是否同步到父任务、且父任务真正在运行
    const runningParent = Boolean(task.inheritParentTime) && task.parentId != null
      ? allTasks.value.find((t) => t.taskId === task.parentId && getRunStatusKey(t) === '1' && !!t.lastStartTime)
      : null;
    if (runningInheritedChildren.length > 0 || runningParent) {
      const reason = runningInheritedChildren.length > 0
        ? '该任务下存在正在计时的子任务（启用了时长同步）'
        : '该任务的父任务正在运行，当前子任务的时长同步会导致重复计算';
      try {
        await ElMessageBox.confirm(
          `${reason}，同时运行会导致时长重复计算。确定要继续吗？`,
          '提示',
          { confirmButtonText: '继续开始', cancelButtonText: '取消', type: 'warning' },
        );
      } catch {
        return;
      }
    }
  }

  // 乐观更新
  task.runStatus = targetStatus === 'IN_PROGRESS' ? '1' : '2';
  task.lastStartTime = targetStatus === 'IN_PROGRESS' ? new Date().toISOString() : prevLastStart;
  // 用覆写表传递运行状态给软约束检查，避免直接改 allTasks.value 触发 tree rebuild
  localRunStatus.value[task.taskId] = targetStatus === 'IN_PROGRESS' ? '1' : '2';
  try {
    await toggleRunStatusApi(task.taskId, targetStatus);
    // 暂停后后端已结算，用实时值同步本地 actualDuration
    if (targetStatus === 'PAUSED') {
      task.actualDuration = settledActual;
    }
  } catch {
    // 回滚
    task.runStatus = prevRunStatus;
    task.lastStartTime = prevLastStart;
    task.actualDuration = prevActual;
    delete localRunStatus.value[task.taskId];
    return;
  }
};

const taskTypeLabel = (type?: string | number) => {
  switch (String(type)) {
    case '0':
      return '随手记';
    case '1':
      return '周期任务';
    case '2':
      return 'DDL';
    case '3':
      return '场景';
    default:
      return '任务';
  }
};

const taskTypeTagType = (type?: string | number) => {
  switch (String(type)) {
    case '3':
      return 'warning';
    case '1':
      return 'success';
    case '2':
      return 'danger';
    default:
      return 'info';
  }
};

function formatDateTimeForPicker(value?: string) {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (num: number) => `${num}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getDatePart(value?: string) {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (num: number) => `${num}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getTimePart(value?: string) {
  if (!value) return '';
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return value.length === 5 ? `${value}:00` : value;
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (num: number) => `${num}`.padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateDatePart(field: 'startTime' | 'endTime', dateValue?: string) {
  if (!dateValue) {
    taskForm[field] = '';
    return;
  }

  if (String(taskForm.type) === '1') {
    taskForm[field] = createRecurringTimeValue(dateValue);
    return;
  }

  const currentTime = getTimePart(taskForm[field]) || '00:00:00';
  taskForm[field] = `${dateValue} ${currentTime}`;
}

function updateTimePart(field: 'startTime' | 'endTime', timeValue?: string) {
  if (!timeValue) {
    taskForm[field] = '';
    return;
  }

  if (String(taskForm.type) === '1') {
    const currentDate = getDatePart(taskForm[field]);
    if (!currentDate) {
      taskForm[field] = `${getTodayDatePart()} ${timeValue}`;
      return;
    }
    taskForm[field] = `${currentDate} ${timeValue}`;
    return;
  }

  const currentDate = getDatePart(taskForm[field]);
  if (!currentDate) {
    taskForm[field] = `${getTodayDatePart()} ${timeValue}`;
    return;
  }
  taskForm[field] = `${currentDate} ${timeValue}`;
}

const updateStartDatePart = (value?: string) => updateDatePart('startTime', value);
const updateStartTimePart = (value?: string) => updateTimePart('startTime', value);
const updateEndDatePart = (value?: string) => updateDatePart('endTime', value);
const updateEndTimePart = (value?: string) => updateTimePart('endTime', value);

const reviewSnippet = (content?: string) => {
  if (!content) return '暂无内容';
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
};

const prettyJson = (value?: string) => {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const formatDuration = (seconds?: number) => {
  const value = Number(seconds || 0);
  const totalMinutes = Math.floor(value / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const remainingSeconds = value % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};

const formatDateOnly = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatTimeOnly = (value?: string) => {
  const timePart = getTimePart(value);
  if (!timePart) return '-';
  return timePart.slice(0, 5);
};

const truncateText = (value?: string, maxLength = 18) => {
  if (!value) return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1))}...`;
};

const formatTaskMetaSummary = (task: Pick<TaskItem, 'description'>) => {
  return truncateText(task.description, 36) || '暂无描述';
};

const formatPlannedDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return '-';
  return formatDuration(seconds);
};

const formatTaskTimeInfo = (startTime?: string, endTime?: string) => {
  const parts: string[] = [];
  if (startTime) parts.push(`开始 ${formatDateTime(startTime)}`);
  if (endTime) parts.push(`结束 ${formatDateTime(endTime)}`);
  return parts.length ? parts.join('；') : '-';
};

const formatRecurrence = (mode: RecurrenceMode, intervalDays?: number, weekdays?: number[], monthDays?: number[]) => {
  if (mode === 'interval') {
    const n = Math.max(1, Number(intervalDays || 1));
    return `[间隔] 每${n}天`;
  }

  if (mode === 'weekly') {
    const names = normalizeNumberList(weekdays || []).map((d) => weekdayOptions.find(o => o.value === d)?.label).filter(Boolean);
    return names.length ? `[每周] ${names.join('、')}` : '[每周]';
  }

  // monthly: 输出为数字列表，前置标签为 [每月]
  const days = normalizeNumberList(monthDays || []);
  if (!days.length) return '[每月]';
  if (days.length === 1) return `[每月] ${days[0]}`;
  return `[每月] ${days.join('、')}`;
};

const formatDateKey = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getBusinessDayDate = (value: Date) => new Date(value.getTime() - 4 * 60 * 60 * 1000);

const formatBusinessDateKey = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return formatDateKey(getBusinessDayDate(date));
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

const endOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
};

const isScene = (task: TaskItem) => String(task.type) === '3';

/**
 * 判断周期任务（type='1'）今天是否属于执行日。
 * 根据 cronConfig 的不同格式：
 * - DAY_INTERVAL|N|anchorTime：每隔 N 天，以 anchor 为基准，计算今天是否命中
 * - 0 mm HH ? * MON,WED,FRI：每周指定星期
 * - 0 mm HH 1,15 * ?：每月指定日期
 * 全部使用业务日（凌晨4点分界）。
 */
const isRecurringTaskToday = (task: TaskItem): boolean => {
  if (String(task.type) !== '1' || !task.cronConfig) return false;

  const config = parseCronConfig(task.cronConfig);
  if (!config) return false;

  const todayBizDate = getBusinessDayDate(new Date());

  if (config.cycleMode === 'interval') {
    // 从原始 cronConfig 中提取 anchor 时间，parseCronConfig 不返回它
    const intervalMatch = /^DAY_INTERVAL\|(\d+)\|([0-9T:\-]+)$/i.exec(task.cronConfig.trim());
    if (!intervalMatch) return false;
    const stepDays = Math.max(1, Number(intervalMatch[1]));
    const anchorStr = intervalMatch[2].replace(' ', 'T');
    const anchorDate = new Date(anchorStr);
    if (Number.isNaN(anchorDate.getTime())) return false;

    const anchorBizKey = formatBusinessDateKey(anchorDate);
    const todayBizKey = formatBusinessDateKey(todayBizDate);
    const anchorDay = new Date(anchorBizKey + 'T00:00:00');
    const todayDay = new Date(todayBizKey + 'T00:00:00');
    const diffDays = Math.floor((todayDay.getTime() - anchorDay.getTime()) / 86_400_000);

    return diffDays >= 0 && diffDays % stepDays === 0;
  }

  if (config.cycleMode === 'weekly') {
    // getDay(): 0=Sun → 转换为 1=Mon…7=Sun
    const jsDayOfWeek = todayBizDate.getDay();
    const bizDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
    return config.cycleWeekdays.includes(bizDayOfWeek);
  }

  if (config.cycleMode === 'monthly') {
    const dayOfMonth = todayBizDate.getDate();
    return config.cycleMonthDays.includes(dayOfMonth);
  }

  return false;
};

const isTodayTask = (task: TaskItem) => {
  if (isScene(task)) return false;
  if (!Boolean(task.active)) return false;
  // 周期任务：靠循环周期判断是否属于今天
  if (String(task.type) === '1') return isRecurringTaskToday(task);
  // 非周期任务：靠 endTime 判断
  if (!task.endTime) return false;
  return formatBusinessDateKey(task.endTime) === todayKey.value;
};

const isTodoTask = (task: TaskItem) => {
  if (isScene(task)) return false;
  return Boolean(task.active) && !Boolean(task.isCompleted);
};

const isTodoTodayTask = (task: TaskItem) => {
  if (!isTodoTask(task)) return false;
  // 周期任务：靠循环周期判断
  if (String(task.type) === '1') return isRecurringTaskToday(task);
  // 非周期任务：靠 endTime 判断
  if (!task.endTime) return false;
  return formatBusinessDateKey(task.endTime) === todayKey.value;
};

const isTodoFutureTask = (task: TaskItem) => {
  if (!isTodoTask(task)) return false;
  // 周期任务：今天属于执行日的在"今日待办"，其余在"后续待办"
  if (String(task.type) === '1') return !isRecurringTaskToday(task);
  // 非周期任务：无 endTime 视为后续
  if (!task.endTime) return true;
  return formatBusinessDateKey(task.endTime) !== todayKey.value;
};

const buildTree = (tasks: TaskItem[]) => {
  const nodeMap = new Map<number, TreeTask>();
  const roots: TreeTask[] = [];

  tasks.forEach((task) => {
    nodeMap.set(task.taskId, { ...task, children: [] });
  });

  tasks.forEach((task) => {
    const current = nodeMap.get(task.taskId)!;
    const parentId = task.parentId ?? null;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children!.push(current);
    } else {
      roots.push(current);
    }
  });

  return sortTree(roots);
};

const sortTree = (nodes: TreeTask[]) => {
  nodes.sort((left, right) => {
    const typeDiff = taskOrderRank(left) - taskOrderRank(right);
    if (typeDiff !== 0) return typeDiff;
    return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
  });

  nodes.forEach((node) => {
    if (node.children?.length) {
      node.children = sortTree(node.children);
    }
  });

  return nodes;
};

const filterSceneTree = (nodes: TreeTask[]): TreeTask[] => {
  return nodes.reduce<TreeTask[]>((accumulator, node) => {
    if (isScene(node)) {
      // 场景节点：保留全部子孙（不递归过滤），让 el-tree 能展开查看所有子任务
      accumulator.push({
        ...node,
        children: node.children ?? [],
      });
      return accumulator;
    }

    if (node.children?.length) {
      accumulator.push(...filterSceneTree(node.children));
    }

    return accumulator;
  }, []);
};

const filterNonSceneTree = (nodes: TreeTask[]): TreeTask[] => {
  return nodes.reduce<TreeTask[]>((accumulator, node) => {
    if (isScene(node)) return accumulator;

    accumulator.push({
      ...node,
      children: node.children ? filterNonSceneTree(node.children) : [],
    });
    return accumulator;
  }, []);
};

const taskOrderRank = (task: TaskItem) => {
  switch (String(task.type)) {
    case '3':
      return 0;
    case '1':
      return 1;
    case '2':
      return 2;
    default:
      return 3;
  }
};

const filterTree = (nodes: TreeTask[], predicate: (task: TaskItem) => boolean): TreeTask[] => {
  return nodes.reduce<TreeTask[]>((accumulator, node) => {
    // 场景节点透明化：不显示自身，将其匹配的子任务提升到当前层级
    if (isScene(node)) {
      const filteredChildren = node.children ? filterTree(node.children, predicate) : [];
      accumulator.push(...filteredChildren);
      return accumulator;
    }

    const filteredChildren = node.children ? filterTree(node.children, predicate) : [];
    if (predicate(node) || filteredChildren.length > 0) {
      accumulator.push({ ...node, children: filteredChildren });
    }
    return accumulator;
  }, []);
};

const countTree = (nodes: TreeTask[], predicate?: (task: TaskItem) => boolean): number => {
  return nodes.reduce((sum, node) => {
    const self = predicate ? (predicate(node) ? 1 : 0) : 1;
    return sum + self + countTree(node.children || [], predicate);
  }, 0);
};

onMounted(async () => {
  await Promise.all([loadTasks(), loadReviews()]);
  const storedDraft = window.localStorage.getItem(draftStorageKey.value);
  if (storedDraft !== null) {
    reviewDraft.value = storedDraft;
  }
  startHeartbeatTimer();
});

watch(reviewDraft, (value) => {
  window.localStorage.setItem(draftStorageKey.value, value);
});

onBeforeUnmount(() => {
  if (reviewDraft.value.trim()) {
    syncReviewDraft();
  }
  stopHeartbeatTimer();
});
</script>

<style scoped>
.home-shell {
  height: 100vh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  background:
    radial-gradient(circle at 20% 15%, rgba(247, 213, 74, 0.14), transparent 24%),
    radial-gradient(circle at 80% 18%, rgba(255, 236, 145, 0.12), transparent 18%),
    linear-gradient(135deg, #fafafa 0%, #f4f5f7 100%);
}

.sidebar {
  padding: 20px 14px;
  background: rgba(255, 255, 255, 0.94);
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
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

.sidebar-footnote {
  color: #8a92a2;
  font-size: 12px;
  line-height: 1.6;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 8px 14px;
  padding: 14px 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
  border: 1px solid rgba(31, 35, 41, 0.08);
  box-shadow: 0 10px 24px rgba(24, 24, 24, 0.06);
}

.user-card-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(247, 213, 74, 0.18);
  color: #8f6b00;
  font-size: 18px;
  flex: 0 0 auto;
}

.user-card-content {
  min-width: 0;
}

.user-card-name {
  font-size: 18px;
  font-weight: 700;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-list {
  display: grid;
  gap: 8px;
}

.nav-item {
  width: 100%;
  padding: 14px 14px;
  text-align: left;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: #394150;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.nav-item small {
  color: #a3adba;
}

.nav-item.active,
.nav-item:hover {
  background: rgba(247, 213, 74, 0.2);
  color: #1f2329;
}

.sidebar-bottom {
  margin-top: auto;
  padding: 18px 8px 6px;
}

.logout-btn {
  width: 100%;
  color: #8b5e00;
  background: linear-gradient(180deg, #ffdf7a 0%, #f7c948 100%);
  border-color: rgba(201, 153, 0, 0.45);
  box-shadow: 0 10px 22px rgba(247, 201, 72, 0.28);
}

.logout-btn:hover,
.logout-btn:focus-visible {
  color: #6f4a00;
  background: linear-gradient(180deg, #ffd55b 0%, #f0bc2d 100%);
  border-color: rgba(174, 124, 0, 0.55);
  box-shadow: 0 12px 24px rgba(247, 201, 72, 0.36);
}

.content-area {
  padding: 28px;
  overflow: auto;
}

.content-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.content-topbar h1 {
  margin: 0 0 6px;
  font-size: 30px;
  letter-spacing: -0.04em;
}

.content-topbar p {
  margin: 0;
  color: #8a92a2;
}

.content-topbar p small {
  margin-left: 10px;
  color: #9aa2af;
  font-size: 12px;
}

.section-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.section-toolbar-left {
  justify-content: flex-start;
}

.panel-card {
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 48px rgba(24, 24, 24, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.82);
}

.panel-card {
  padding: 20px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-head-actions-left {
  justify-content: flex-start;
}

.panel-head-compact {
  align-items: center;
}

.panel-head-stacked {
  flex-direction: column;
  align-items: flex-start;
}

.panel-head-stacked .panel-head-title {
  margin-left: 0;
}

.panel-head-stacked .panel-head-actions {
  margin-top: 8px;
}

.panel-head-title {
  margin-left: auto;
  font-size: 16px;
  font-weight: 700;
  color: #1f2329;
}

.panel-head h3 {
  margin: 0 0 6px;
  font-size: 20px;
}

.panel-head p {
  margin: 0;
  color: #8a92a2;
  line-height: 1.6;
}

.panel-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.task-tree {
  background: transparent;
  overflow-x: hidden;
}

.task-tree :deep(.el-tree-node__content) {
  height: auto;
  padding: 4px 0;
  border-radius: 14px;
  overflow: hidden;
}

.task-tree :deep(.el-tree-node__content:hover) {
  background: rgba(255, 255, 255, 0.72);
}

.task-tree :deep(.el-tree-node__children) {
  margin-left: 10px;
  padding-left: 12px;
  border-left: 1px solid rgba(194, 199, 208, 0.7);
}

.task-node {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 10px;
  margin: 2px 0;
  border: 1px solid rgba(194, 199, 208, 0.58);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 3px 10px rgba(31, 35, 41, 0.028);
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}

.task-node-main {
  width: 100%;
  min-width: 0;
  flex: 1;
}

.task-node-title-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
}

.task-node-clock {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
  width: 234px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(147, 197, 253, 0.12);
  border: 1px solid rgba(147, 197, 253, 0.3);
}

.task-type-icon {
  flex: 0 0 auto;
  font-size: 18px;
}

.task-type-icon-recurring {
  color: #2f80ed;
}

.task-type-icon-ddl {
  color: #fb7676;
}

.task-type-icon-note {
  color: #6b7280;
}

/* ===== 场景（文件夹）专属样式 ===== */
.task-type-icon-scene {
  color: #d4a017;
  font-size: 20px;
}

.scene-node {
  background: linear-gradient(135deg, rgba(247, 213, 74, 0.06), rgba(255, 236, 145, 0.10));
  border: 1px solid rgba(212, 160, 23, 0.28);
  border-left: 4px solid rgba(212, 160, 23, 0.45);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(180, 130, 0, 0.06);
  padding: 10px 14px;
}

.scene-node:hover {
  background: linear-gradient(135deg, rgba(247, 213, 74, 0.12), rgba(255, 236, 145, 0.16));
  border-color: rgba(212, 160, 23, 0.45);
  border-left-color: rgba(180, 130, 0, 0.55);
}

.scene-title-row {
  padding-right: 0;
}

.scene-node-title {
  font-size: 15px;
  color: #5a4700;
}

.scene-node-desc {
  color: #a09050;
}

/* 场景子节点在 tree 内缩进但不继承场景卡片样式 */
.scene-tree :deep(.el-tree-node__children .scene-node) {
  background: rgba(249, 250, 252, 0.96);
  border-left-color: rgba(212, 160, 23, 0.22);
  box-shadow: none;
}

.task-node-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  font-weight: 700;
  color: #1f2329;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-node-clock {
  display: flex;
  align-items: center;
  gap: 6px;
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 234px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(147, 197, 253, 0.12);
  border: 1px solid rgba(147, 197, 253, 0.3);
  z-index: 1;
}

.task-run-toggle {
  width: 33px;
  height: 33px;
  padding: 0;
  border: none;
  background: transparent;
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 21px;
}

.task-run-toggle:hover {
  color: #1d4ed8;
}

.task-node-clock-bar {
  width: 100%;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.clock-progress-text {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  white-space: nowrap;
  line-height: 1;
}

.task-node-clock:not(.is-running) {
  background: rgba(229, 231, 235, 0.4);
  border-color: rgba(209, 213, 219, 0.85);
}

.btn-enable {
  background-color: #fff9c4; /* pale yellow */
  color: #7a5a00;
  border: 1px solid #f3eaa8;
}

.btn-disable {
  background-color: #f3f4f6; /* light gray */
  color: #6b6b6b;
  border: 1px solid #e5e7eb;
}

.btn-subdivide {
  background-color: #e6f4ff; /* light blue */
  color: #0b61a6;
  border: 1px solid #cfe9ff;
}

.btn-revoke {
  background-color: #f3e8ff; /* pale lavender */
  color: #5b21b6;
  border: 1px solid #e6d6ff;
}

.btn-complete {
  background-color: #d1fae5; /* light green */
  color: #065f46;
  border: 1px solid #a7f3d0;
}

/* 交互样式：复制 Element Plus `success` 按钮的过渡/阴影/按下反馈，保留各自配色 */
.btn-enable, .btn-disable, .btn-subdivide, .btn-revoke, .btn-complete {
  padding: 4px 8px; /* smaller */
  border-radius: 6px;
  font-size: 12px; /* slightly smaller */
  cursor: pointer;
  transition: box-shadow 0.12s ease, filter 0.12s ease;
  box-shadow: none;
}

.btn-enable:hover, .btn-disable:hover, .btn-subdivide:hover, .btn-revoke:hover, .btn-complete:hover {
  filter: brightness(0.97);
  box-shadow: 0 6px 16px rgba(16,24,40,0.08);
}

.btn-enable:active, .btn-disable:active, .btn-subdivide:active, .btn-revoke:active, .btn-complete:active {
  box-shadow: 0 3px 8px rgba(16,24,40,0.06);
}

/* Ensure Element Plus buttons inside action area also use compact spacing */
.task-node-actions .el-button {
  padding: 4px 8px !important;
  font-size: 12px !important;
  height: auto !important;
  min-width: 0 !important;
}

.task-active-toggle {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.active-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex: 0 0 auto;
  background: #e6e7ea;
  border: 1px solid rgba(0,0,0,0.06);
}

.dot-completed {
  background: #34d399; /* green */
  box-shadow: 0 0 0 4px rgba(52,211,153,0.08);
}

.dot-pending {
  background: #f59e0b; /* orange */
  box-shadow: 0 0 0 4px rgba(245,158,11,0.06);
}

.dot-inactive {
  background: #e6e7ea; /* gray */
  border-color: #d1d5db;
}

.task-node-main {
  cursor: pointer;
}

.task-node-desc {
  flex: 0 1 auto;
  max-width: 200px;
  min-width: 0;
  margin-left: 0px;
  font-size: 12px;
  font-weight: 400;
  color: #8a92a2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
  padding-bottom: 1px;
  align-self: flex-end;
}

.task-node-children-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 7.5px;
  background: rgba(59, 130, 246, 0.25);
  border: 1px solid rgba(59, 130, 246, 0.50);
  color: #2563eb;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  margin-left: 0px;
  margin-right: 0px;
  user-select: none;
}

.task-tree :deep(.el-tree-node__children .task-node) {
  background: rgba(249, 250, 252, 0.96);
  border-color: rgba(194, 199, 208, 0.42);
  box-shadow: none;
}

.task-tree :deep(.el-tree-node__children .task-node-main) {
  opacity: 0.98;
}

.task-node-meta {
  width: 100%;
  display: block;
  color: #8a92a2;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-inline-action {
  padding: 0;
  font-size: 12px;
}

.task-node-meta-inline {
  padding-top: 0;
}

.task-dialog-section-title {
  margin: 4px 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: #1f2329;
}

.task-dialog-section-block {
  margin-top: 2px;
}

.task-dialog-helper-text {
  margin-top: 6px;
  color: #8a92a2;
  font-size: 12px;
  line-height: 1.6;
}

.task-settlement-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: #1f2329;
}

.task-settlement-help {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid #c4c9d1;
  color: #8a92a2;
  font-size: 12px;
  line-height: 1;
  cursor: help;
  user-select: none;
}

.task-node-actions {
  width: 100%;
  display: flex;
  gap: 2px; /* reduced spacing */
  flex-wrap: wrap;
  justify-content: flex-start;
  padding-top: 4px; /* slightly smaller */
  border-top: none;
  min-width: 0;
}

.review-layout {
  display: grid;
  gap: 18px;
}

.task-split-layout {
  display: grid;
  gap: 18px;
}

.task-split-card {
  display: grid;
}

.review-editor-card {
  display: grid;
  gap: 12px;
}

.review-tips {
  color: #8a92a2;
  font-size: 12px;
  line-height: 1.7;
}

.review-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 18px;
}

.review-list {
  display: grid;
  gap: 10px;
  max-height: 520px;
  overflow: auto;
  padding-right: 4px;
}

.review-item {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  background: #fff;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.review-item.active,
.review-item:hover {
  border-color: rgba(247, 213, 74, 0.6);
  box-shadow: 0 10px 22px rgba(247, 213, 74, 0.12);
}

.review-item-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}

.review-item-top strong {
  font-size: 15px;
}

.review-item-top span,
.review-item-snippet {
  color: #8a92a2;
  font-size: 12px;
  line-height: 1.7;
}

.review-detail-card {
  display: grid;
  gap: 14px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.detail-item {
  border-radius: 16px;
  background: linear-gradient(180deg, #fff9e0, #fff);
  padding: 14px;
  border: 1px solid rgba(247, 213, 74, 0.2);
}

.detail-item span {
  display: block;
  color: #8f6b00;
  font-size: 12px;
  margin-bottom: 6px;
}

.detail-item strong {
  font-size: 20px;
}

.detail-block {
  display: grid;
  gap: 8px;
}

.detail-block-label {
  color: #1f2329;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
}

.read-only-view {
  gap: 100em;
}

.read-only-view .detail-block {
  gap: 0em;
}

.read-only-view .detail-block > div:last-child {
  color: #1f2329;
  font-weight: 400;
  font-size: 13px;
  line-height: 1.5;
}

.read-only-view .detail-block-label {
  color: #1f2329;
  line-height: 1.5;
}

/* Bold dialog title in view mode */
.task-dialog.view-mode :deep(.el-dialog__title) {
  font-weight: 800 !important;
  color: #1f2329 !important;
  font-size: 18px !important;
}

.task-dialog.view-mode :deep(.el-dialog__header) {
  /* slightly larger title */
  font-size: 18px !important;
}

.detail-pre {
  margin: 0;
  padding: 16px;
  border-radius: 16px;
  background: #f9fafc;
  color: #394150;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

/* Minimal text container that preserves newlines only (no background/padding) */
.detail-text {
  margin: 0;
  color: #394150;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

.heatmap-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.heatmap-row {
  display: flex;
  gap: 2px;
  align-items: center;
}

.heatmap-row-label {
  width: 90px;
  flex: 0 0 auto;
  font-size: 11.5px;
  color: #8a92a2;
  text-align: right;
  padding-right: 6px;
  line-height: 1;
}

.heatmap-seg {
  flex: 1 1 0;
  min-width: 0;
  height: 14px;
  border-radius: 2px;
  background: #e5e7eb;
}

.heatmap-seg.is-active {
  background: #34d399;
}

.heatmap-legend {
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 12px;
  color: #8a92a2;
  margin-top: 6px;
}

.heatmap-legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #e5e7eb;
}

.heatmap-legend-dot.active {
  background: #34d399;
}

/* Strong override and ensure read-only spacing takes effect despite other rules */
.task-dialog-page.read-only-view {
  gap: 1.2em !important;
}
.task-dialog-page.read-only-view .detail-block {
  gap: 0em !important;
}
.read-only-view strong {
  font-weight: 400 !important;
}

.detail-footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ===== TaskLog 列表样式 ===== */
.tasklog-section {
  margin-top: 4px;
}

.tasklog-count {
  font-weight: 400;
  color: #8a92a2;
  font-size: 12px;
}

.tasklog-loading {
  font-size: 12px;
  color: #8a92a2;
  padding: 8px 0;
}

.tasklog-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.tasklog-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  background: #f9fafc;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.tasklog-item:hover {
  background: #f0f4ff;
  border-color: rgba(59, 130, 246, 0.3);
}

.tasklog-item-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.tasklog-item-left .task-type-icon {
  flex-shrink: 0;
  font-size: 16px;
}

.tasklog-item-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tasklog-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tasklog-result-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  white-space: nowrap;
}

.status-unstarted { background: #f3f4f6; color: #6b7280; }
.status-incomplete { background: #fee2e2; color: #dc2626; }
.status-completed { background: #d1fae5; color: #065f46; }
.status-late { background: #fef3c7; color: #92400e; }
.status-deferred { background: #ede9fe; color: #6d28d9; }

.tasklog-duration {
  font-size: 12px;
  color: #8a92a2;
  font-weight: 500;
  white-space: nowrap;
}

.w-full {
  width: 100%;
}

.task-dialog :deep(.el-dialog__body) {
  display: grid;
  gap: 10px;
  padding: 10px 20px 8px;
}

.task-dialog-steps {
  margin-bottom: 4px;
}

.task-dialog-parent-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  margin-bottom: 10px;
  border-radius: 14px;
  background: #f7f9fc;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.task-dialog-parent-chip span {
  color: #8a92a2;
  font-size: 12px;
}

.task-dialog-alert {
  margin: 0 0 10px 0;
}

.task-dialog-form {
  display: grid;
}

.task-dialog :deep(.el-form-item) {
  margin-bottom: 14px;
}

.task-datetime-row {
  width: 100%;
}

.task-dialog-page {
  display: grid;
  gap: 2px;
  align-content: start;
}

.task-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
}

@media (max-width: 1100px) {
  .review-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  /* === 整体：flex column 三段 === */
  .home-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* === 区块1：顶部条（logo + 用户名片 + 退出） === */
  .sidebar {
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    height: auto;
    overflow: visible;
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: rgba(255, 255, 255, 0.97);
  }

  .brand {
    padding: 4px 6px;
  }

  .brand-mark {
    width: 30px;
    height: 30px;
  }

  .brand-title {
    font-size: 15px;
  }

  .user-card {
    margin: 0 0 0 auto;
    padding: 4px 8px;
    flex: 0 0 auto;
    border-radius: 10px;
    box-shadow: none;
    border: none;
    background: transparent;
  }

  .user-card-icon {
    width: 26px;
    height: 26px;
  }

  .user-card-name {
    font-size: 13px;
  }

  .sidebar-bottom {
    margin: 0 0 0 8px;
    padding: 0;
    flex: 0 0 auto;
  }

  .logout-btn {
    padding: 4px 10px;
    font-size: 12px;
    width: auto;
    border-radius: 8px;
  }

  /* === 区块2：内容区（填满剩余空间） === */
  .content-area {
    flex: 1 1 0;
    min-height: 0;
    padding: 14px;
    padding-bottom: 64px;
    overflow-y: auto;
    box-sizing: border-box;
  }

  /* === 区块3：底部固定条（四个导航按钮） === */
  .sidebar > .nav-list {
    display: none;
  }

  .nav-list {
    display: flex !important;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 4px;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.97);
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(0, 0, 0, 0.08);
  }

  .nav-item {
    flex: 1 1 0;
    min-width: 0;
    padding: 8px 6px;
    font-size: 12px;
    border-radius: 10px;
    justify-content: center;
  }

  .nav-item small {
    font-size: 10px;
  }
}

@media (max-width: 740px) {
  /* 窄任务卡：缩小时钟条，渐变收缩描述/标题 */
  .task-node-desc {
    max-width: 80px;
  }

  .task-node-clock {
    width: 190px;
    padding: 3px 7px;
    gap: 4px;
  }

  .task-run-toggle {
    width: 28px;
    height: 28px;
    font-size: 18px;
  }

  .clock-progress-text {
    font-size: 11px;
  }
}

@media (max-width: 640px) {
  .content-area {
    padding: 14px;
  }

  .panel-card {
    padding: 16px;
    border-radius: 20px;
  }

  .content-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-toolbar {
    margin-bottom: 14px;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .task-node-desc {
    display: none;
  }

  .task-node-children-badge {
    display: none;
  }

  .task-node-clock {
    width: 170px;
    padding: 2px 6px;
    gap: 3px;
  }

  .task-run-toggle {
    width: 26px;
    height: 26px;
    font-size: 16px;
  }

  .clock-progress-text {
    font-size: 10px;
  }

  .task-node-actions .el-button {
    padding: 3px 6px !important;
    font-size: 11px !important;
  }
}
</style>