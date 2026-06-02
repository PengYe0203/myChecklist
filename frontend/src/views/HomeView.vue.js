import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Calendar, Clock, Document, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { createTaskApi, deleteTaskApi, heartbeatApi, getAllTasksApi, updateTaskApi, toggleActiveApi, toggleCompleteApi, toggleRunStatusApi, } from '@/api/task';
import { editReviewApi, getAllReviewsApi } from '@/api/review';
const router = useRouter();
const authStore = useAuthStore();
const activeSection = ref('today');
const loadingTasks = ref(false);
const savingReview = ref(false);
const heartbeatNow = ref(Date.now());
const heartbeatSyncing = ref(false);
const taskDialogVisible = ref(false);
const taskDialogStep = ref(0);
const taskDialogMode = ref('create');
const taskDialogLoading = ref(false);
const taskDialogParent = ref(null);
const taskFormRef = ref();
const allTasks = ref([]);
const reviewHistory = ref([]);
const selectedReviewId = ref(null);
const reviewDraft = ref('');
const recurringTaskDraft = ref(null);
const taskTypeOptions = [
    { label: '随手记', value: 0 },
    { label: '周期任务', value: 1 },
    { label: 'DDL', value: 2 },
];
const recurringDefaultTime = '04:00:00';
const HEARTBEAT_INTERVAL_MS = 60000;
let heartbeatTimer = null;
const cycleModeOptions = [
    { label: '每几天执行一次', value: 'interval' },
    { label: '每周指定星期', value: 'weekly' },
    { label: '每月指定日期', value: 'monthly' },
];
const weekdayOptions = [
    { label: '周一', value: 1 },
    { label: '周二', value: 2 },
    { label: '周三', value: 3 },
    { label: '周四', value: 4 },
    { label: '周五', value: 5 },
    { label: '周六', value: 6 },
    { label: '周日', value: 7 },
];
const monthDayOptions = Array.from({ length: 31 }, (_, index) => ({
    label: `${index + 1}号`,
    value: index + 1,
}));
const weekdayNameMap = {
    1: 'MON',
    2: 'TUE',
    3: 'WED',
    4: 'THU',
    5: 'FRI',
    6: 'SAT',
    7: 'SUN',
};
const weekdayTokenMap = {
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
    SUN: 7,
};
const settlementTypeOptions = [
    { label: '手动结算', value: 0 },
    { label: '自动结算', value: 1 },
];
const normalizeNumberList = (values) => Array.from(new Set(values)).sort((left, right) => left - right);
const parseHeartbeatTime = (value) => {
    if (!value)
        return null;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const localRunStatus = ref({});
const getRunStatusKey = (task) => {
    const local = localRunStatus.value[task.taskId];
    return local ?? String(task.runStatus ?? 0);
};
const getRunStatusHasLastStart = (task) => {
    // 覆写表中有该任务 key 说明被乐观更新过，视为有 lastStartTime
    if (localRunStatus.value[task.taskId] !== undefined)
        return true;
    return !!task.lastStartTime;
};
const isHeartbeatTask = (task) => getRunStatusKey(task) === '1' && getRunStatusHasLastStart(task) && !task.isCompleted;
const nextRunStatus = (task) => (isHeartbeatTask(task) ? 'PAUSED' : 'IN_PROGRESS');
const liveActual = (task) => {
    const base = Number(task.actualDuration ?? 0);
    if (!isHeartbeatTask(task))
        return base;
    const start = parseHeartbeatTime(task.lastStartTime);
    if (!start)
        return base;
    const elapsed = Math.max(0, Math.floor((heartbeatNow.value - start.getTime()) / 1000));
    return base + elapsed;
};
const progressPercent = (task) => {
    const target = Number(task.targetDuration ?? 0);
    if (target <= 0)
        return 0;
    return Math.min(100, Math.round((liveActual(task) / target) * 100));
};
const formatDurationHMS = (seconds) => {
    const value = Math.max(0, Number(seconds ?? 0));
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    const pad = (n) => `${n}`.padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
const clockLabel = (task) => {
    const actual = formatDurationHMS(liveActual(task));
    const target = Number(task.targetDuration ?? 0) > 0 ? formatDurationHMS(task.targetDuration) : '--:--:--';
    return `${actual} / ${target}`;
};
const startHeartbeatTimer = () => {
    if (heartbeatTimer !== null)
        return;
    heartbeatTimer = window.setInterval(() => {
        heartbeatNow.value = Date.now();
        if (heartbeatSyncing.value)
            return;
        const runningTasks = allTasks.value.filter(isHeartbeatTask);
        const dueTasks = runningTasks.filter((task) => {
            const start = parseHeartbeatTime(task.lastStartTime);
            if (!start)
                return false;
            return heartbeatNow.value - start.getTime() >= HEARTBEAT_INTERVAL_MS;
        });
        if (!dueTasks.length)
            return;
        heartbeatSyncing.value = true;
        void Promise.all(dueTasks.map((task) => heartbeatApi(task.taskId).catch(() => { }))).finally(async () => {
            await loadTasks();
            heartbeatSyncing.value = false;
        });
    }, 1000);
};
const stopHeartbeatTimer = () => {
    if (heartbeatTimer === null)
        return;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
};
const getTodayDatePart = () => {
    const now = new Date();
    const pad = (num) => `${num}`.padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const combineDateWithTime = (timeValue) => {
    if (!timeValue)
        return '';
    return `${getTodayDatePart()} ${timeValue}`;
};
const parseCronConfig = (cron) => {
    if (!cron)
        return null;
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
        const cycleWeekdays = normalizeNumberList(tokens
            .map((token) => weekdayTokenMap[token.trim()])
            .filter((value) => Number.isFinite(value)));
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
        const cycleMonthDays = normalizeNumberList(monthlyMatch[3]
            .split(',')
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= 31));
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
const createRecurringTimeValue = (dateValue) => {
    if (!dateValue)
        return '';
    return combineDateWithTime(dateValue);
};
const normalizeCycleValues = (mode, form) => {
    if (mode === 'interval') {
        return `interval:${Math.max(1, Number(form.cycleIntervalDays || 1))}`;
    }
    if (mode === 'weekly') {
        return `weekly:${normalizeNumberList(form.cycleWeekdays).map((value) => weekdayNameMap[value]).filter(Boolean).join(',')}`;
    }
    return `monthly:${normalizeNumberList(form.cycleMonthDays).join(',')}`;
};
const normalizeParsedCycleValues = (mode, parsed) => {
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
const getParsedCycleSignature = (cron) => {
    const parsed = parseCronConfig(cron);
    if (!parsed)
        return '';
    return normalizeParsedCycleValues(parsed.cycleMode, parsed);
};
const createDefaultTaskForm = (parentTask, sourceTask, presetType, defaultActive = true) => {
    const parentType = parentTask ? String(parentTask.type ?? '') : '';
    const inheritedType = parentType === '3' ? 0 : Number(parentType || 0);
    const sourceType = sourceTask ? Number(sourceTask.type ?? inheritedType ?? 0) : inheritedType;
    const requestedType = Number(presetType ?? sourceType);
    const normalizedType = Number.isFinite(requestedType) ? requestedType : 0;
    const sourceSettlement = sourceTask ? Number(sourceTask.settlementType ?? 0) : Number(parentTask?.settlementType ?? 0);
    const parsedCron = parseCronConfig(sourceTask?.cronConfig ?? parentTask?.cronConfig);
    const sourceDurationSeconds = sourceTask?.targetDuration ?? parentTask?.targetDuration ?? 0;
    const totalMinutes = Math.max(0, Math.round(sourceDurationSeconds / 60));
    const resolveDefaultDateTime = (value) => {
        if (!value)
            return '';
        const normalized = value.includes('T') ? value : value.replace(' ', 'T');
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime()))
            return '';
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
    const form = {
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
        inheritParentTime: sourceTask?.inheritParentTime ?? (parentTask ? true : false),
        active: sourceTask?.active ?? defaultActive,
        isCompleted: sourceTask?.isCompleted ?? false,
    };
    return form;
};
const snapshotRecurringDraft = () => ({
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
const restoreRecurringDraft = (draft) => {
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
const taskForm = reactive(createDefaultTaskForm());
const displayUsername = computed(() => authStore.username || '未命名用户');
const isRecurringTask = computed(() => String(taskForm.type) === '1');
const taskDialogTitle = computed(() => {
    if (taskDialogMode.value === 'view')
        return taskForm.title || '任务详情';
    if (taskDialogMode.value === 'edit')
        return '编辑任务';
    if (taskForm.type === 3)
        return '新建场景';
    return taskDialogParent.value ? '新建子任务' : '新建任务';
});
const taskDialogWarnings = computed(() => {
    const warnings = [];
    const parent = taskDialogParent.value;
    if (!parent)
        return warnings;
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
    if (parentType !== childType && warnings.length === 0) {
        warnings.push(`父任务是${taskTypeLabel(parentType)}，当前子任务是${taskTypeLabel(childType)}，子任务将独立进行。`);
    }
    return Array.from(new Set(warnings));
});
const validateRecurringIntervalDays = (_rule, _value, callback) => {
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
const validateRecurringWeekdays = (_rule, _value, callback) => {
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
const validateRecurringMonthDays = (_rule, _value, callback) => {
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
const taskFormRules = computed(() => {
    const rules = {
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
watch(() => taskForm.type, (type, previousType) => {
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
});
const treeProps = {
    children: 'children',
    label: 'title',
};
const sectionMeta = {
    today: { label: '今日任务', badge: 'TODAY FOCUS', description: '完成时间在今日且仍处于激活中的任务。' },
    todo: { label: '待办任务', badge: 'TODO LIST', description: '未完成且激活的任务，按今日和后续分组。' },
    all: { label: '全部任务', badge: 'ALL TASKS', description: '' },
    review: { label: '回顾', badge: 'DAILY REVIEW', description: '今日总结草稿 + 历史 review 详情。' },
};
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
const sectionItems = computed(() => {
    const items = [
        { key: 'today', label: sectionMeta.today.label, countLabel: `${countTree(currentTodayTree.value)} 项` },
        { key: 'todo', label: sectionMeta.todo.label, countLabel: `${countTree(currentTodoTree.value)} 项` },
        { key: 'all', label: sectionMeta.all.label, countLabel: `${countTree(currentAllTree.value)} 项` },
        { key: 'review', label: sectionMeta.review.label, countLabel: `${reviewHistory.value.length} 条` },
    ];
    return items;
});
const setActiveSection = (key) => {
    if (key === 'today' || key === 'todo' || key === 'all' || key === 'review') {
        activeSection.value = key;
    }
};
const activeSectionTitle = computed(() => sectionMeta[activeSection.value].label);
const activeSectionBadge = computed(() => sectionMeta[activeSection.value].badge);
const isSceneDialog = computed(() => taskDialogMode.value === 'create' && String(taskForm.type) === '3');
const currentAllTree = computed(() => buildTree(allTasks.value));
const sceneTaskTree = computed(() => filterSceneTree(currentAllTree.value));
const nonSceneTaskTree = computed(() => filterNonSceneTree(currentAllTree.value));
const currentTodayTree = computed(() => filterTree(currentAllTree.value, isTodayTask));
const currentTodoTree = computed(() => filterTree(currentAllTree.value, isTodoTask));
const currentTodoTodayTree = computed(() => filterTree(currentAllTree.value, isTodoTodayTask));
const currentTodoFutureTree = computed(() => filterTree(currentAllTree.value, isTodoFutureTask));
const currentTaskTree = computed(() => {
    if (activeSection.value === 'today')
        return currentTodayTree.value;
    if (activeSection.value === 'todo')
        return currentTodoTree.value;
    return currentAllTree.value;
});
const selectedReview = computed(() => reviewHistory.value.find((item) => item.reviewId === selectedReviewId.value) ?? null);
const resetTaskDialog = () => {
    Object.assign(taskForm, createDefaultTaskForm());
    taskDialogStep.value = 0;
    taskDialogMode.value = 'create';
    taskDialogParent.value = null;
    taskDialogLoading.value = false;
    recurringTaskDraft.value = null;
    taskFormRef.value?.clearValidate();
};
const findTaskById = (taskId) => {
    if (taskId == null)
        return null;
    return allTasks.value.find((task) => task.taskId === taskId) ?? null;
};
const openCreateTaskDialog = (parentTask, defaultActive = true) => {
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
const openEditTaskDialog = (task) => {
    taskDialogMode.value = 'edit';
    taskDialogParent.value = findTaskById(task.parentId);
    Object.assign(taskForm, createDefaultTaskForm(taskDialogParent.value, task));
    recurringTaskDraft.value = String(taskForm.type) === '1' ? snapshotRecurringDraft() : null;
    taskDialogStep.value = 0;
    taskDialogVisible.value = true;
};
const openViewTaskDialog = (task) => {
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
    }
    catch {
        // 校验提示由表单自身展示
    }
};
const buildCronConfig = () => {
    if (String(taskForm.type) !== '1')
        return undefined;
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
    const normalizeDateTimeForApi = (value) => {
        if (!value)
            return null;
        return value.includes('T') ? value : value.replace(' ', 'T');
    };
    const normalizeRecurringDateTimeForApi = (value) => {
        if (!value)
            return null;
        if (value.includes('T'))
            return value;
        if (value.includes(' '))
            return value.replace(' ', 'T');
        return `${getTodayDatePart()}T${value.length === 5 ? `${value}:00` : value}`;
    };
    const payload = {
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
    if (!taskFormRef.value)
        return;
    try {
        await taskFormRef.value.validate();
    }
    catch {
        return;
    }
    // 验证：如果同时填写了起止时间，确保结束时间不早于开始时间
    const parseForCompare = (value, isRecurring = false) => {
        if (!value)
            return null;
        if (value.includes('T'))
            return new Date(value.replace(' ', 'T'));
        if (value.includes(' '))
            return new Date(value.replace(' ', 'T'));
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
    }
    catch {
        // 具体错误由全局拦截器提示；这里吞掉异常避免事件处理器抛出未处理 promise
    }
    finally {
        taskDialogLoading.value = false;
    }
};
const deleteTask = async (task) => {
    try {
        await ElMessageBox.confirm(`确认删除任务「${task.title}」及其所有子任务吗？`, '删除任务', {
            type: 'warning',
            confirmButtonText: '删除',
            cancelButtonText: '取消',
        });
    }
    catch {
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
    }
    finally {
        loadingTasks.value = false;
    }
};
const loadReviews = async () => {
    const response = await getAllReviewsApi();
    reviewHistory.value = [...(response.data || [])].sort((left, right) => right.date.localeCompare(left.date));
    const todayReview = reviewHistory.value.find((item) => formatDateKey(item.date) === todayKey.value);
    if (todayReview) {
        selectedReviewId.value = todayReview.reviewId;
    }
    else if (!selectedReviewId.value && reviewHistory.value.length) {
        selectedReviewId.value = reviewHistory.value[0].reviewId;
    }
    const storedDraft = window.localStorage.getItem(draftStorageKey.value);
    if (storedDraft !== null) {
        reviewDraft.value = storedDraft;
    }
    else if (todayReview?.content) {
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
        ElMessage.success('今日总结已保存到后端');
        await loadReviews();
    }
    finally {
        savingReview.value = false;
    }
};
const selectReview = (review) => {
    selectedReviewId.value = review.reviewId;
};
const handleLogout = async () => {
    authStore.logout();
    await router.push('/login');
};
const toggleActive = async (task) => {
    const prevActive = !!task.active;
    task.active = !prevActive;
    try {
        await toggleActiveApi(task.taskId, !prevActive);
        ElMessage.success('任务状态已更新');
    }
    catch {
        task.active = prevActive;
    }
};
const toggleComplete = async (task) => {
    const prevCompleted = !!task.isCompleted;
    task.isCompleted = !prevCompleted;
    try {
        await toggleCompleteApi(task.taskId, !prevCompleted);
        ElMessage.success('完成状态已更新');
    }
    catch {
        task.isCompleted = prevCompleted;
    }
};
const toggleRunStatus = async (task) => {
    const targetStatus = nextRunStatus(task);
    const prevRunStatus = String(task.runStatus ?? '0');
    const prevLastStart = task.lastStartTime;
    const prevActual = task.actualDuration;
    const settledActual = liveActual(task); // 暂停前先记下实时值
    // 软约束：启动任务时如果存在时长同步冲突，弹窗提醒
    if (targetStatus === 'IN_PROGRESS') {
        // 1. 该任务下是否存在真正在运行且同步的子任务（有 lastStartTime 才算运行）
        const runningInheritedChildren = allTasks.value.filter((t) => t.parentId === task.taskId
            && getRunStatusKey(t) === '1'
            && !!t.lastStartTime
            && Boolean(t.inheritParentTime));
        // 2. 该任务是否同步到父任务、且父任务真正在运行
        const runningParent = Boolean(task.inheritParentTime) && task.parentId != null
            ? allTasks.value.find((t) => t.taskId === task.parentId && getRunStatusKey(t) === '1' && !!t.lastStartTime)
            : null;
        if (runningInheritedChildren.length > 0 || runningParent) {
            const reason = runningInheritedChildren.length > 0
                ? '该任务下存在正在计时的子任务（启用了时长同步）'
                : '该任务的父任务正在运行，当前子任务的时长同步会导致重复计算';
            try {
                await ElMessageBox.confirm(`${reason}，同时运行会导致时长重复计算。确定要继续吗？`, '提示', { confirmButtonText: '继续开始', cancelButtonText: '取消', type: 'warning' });
            }
            catch {
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
    }
    catch {
        // 回滚
        task.runStatus = prevRunStatus;
        task.lastStartTime = prevLastStart;
        task.actualDuration = prevActual;
        delete localRunStatus.value[task.taskId];
        return;
    }
};
const taskTypeLabel = (type) => {
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
const taskTypeTagType = (type) => {
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
function formatDateTimeForPicker(value) {
    if (!value)
        return '';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime()))
        return '';
    const pad = (num) => `${num}`.padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function getDatePart(value) {
    if (!value)
        return '';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime()))
        return '';
    const pad = (num) => `${num}`.padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function getTimePart(value) {
    if (!value)
        return '';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
        return value.length === 5 ? `${value}:00` : value;
    }
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime()))
        return '';
    const pad = (num) => `${num}`.padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function updateDatePart(field, dateValue) {
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
function updateTimePart(field, timeValue) {
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
const updateStartDatePart = (value) => updateDatePart('startTime', value);
const updateStartTimePart = (value) => updateTimePart('startTime', value);
const updateEndDatePart = (value) => updateDatePart('endTime', value);
const updateEndTimePart = (value) => updateTimePart('endTime', value);
const reviewSnippet = (content) => {
    if (!content)
        return '暂无内容';
    const compact = content.replace(/\s+/g, ' ').trim();
    return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
};
const prettyJson = (value) => {
    if (!value)
        return '';
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    }
    catch {
        return value;
    }
};
const formatDuration = (seconds) => {
    const value = Number(seconds || 0);
    const totalMinutes = Math.floor(value / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const remainingSeconds = value % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
};
const formatDateOnly = (value) => {
    if (!value)
        return '-';
    return new Date(value).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
};
const formatDateTime = (value) => {
    if (!value)
        return '-';
    return new Date(value).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};
const formatTimeOnly = (value) => {
    const timePart = getTimePart(value);
    if (!timePart)
        return '-';
    return timePart.slice(0, 5);
};
const truncateText = (value, maxLength = 18) => {
    if (!value)
        return '';
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength)
        return compact;
    return `${compact.slice(0, Math.max(1, maxLength - 1))}...`;
};
const formatTaskMetaSummary = (task) => {
    return truncateText(task.description, 36) || '暂无描述';
};
const formatPlannedDuration = (seconds) => {
    if (!seconds || seconds <= 0)
        return '-';
    return formatDuration(seconds);
};
const formatTaskTimeInfo = (startTime, endTime) => {
    const parts = [];
    if (startTime)
        parts.push(`开始 ${formatDateTime(startTime)}`);
    if (endTime)
        parts.push(`结束 ${formatDateTime(endTime)}`);
    return parts.length ? parts.join('；') : '-';
};
const formatRecurrence = (mode, intervalDays, weekdays, monthDays) => {
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
    if (!days.length)
        return '[每月]';
    if (days.length === 1)
        return `[每月] ${days[0]}`;
    return `[每月] ${days.join('、')}`;
};
const formatDateKey = (value) => {
    const date = typeof value === 'string' ? new Date(value) : value;
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const getBusinessDayDate = (value) => new Date(value.getTime() - 4 * 60 * 60 * 1000);
const formatBusinessDateKey = (value) => {
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
const isScene = (task) => String(task.type) === '3';
const isTodayTask = (task) => {
    if (isScene(task))
        return false;
    if (!Boolean(task.active) || !task.endTime)
        return false;
    return formatBusinessDateKey(task.endTime) === todayKey.value;
};
const isTodoTask = (task) => {
    if (isScene(task))
        return false;
    return Boolean(task.active) && !Boolean(task.isCompleted);
};
const isTodoTodayTask = (task) => {
    if (!isTodoTask(task))
        return false;
    if (!task.endTime)
        return false;
    return formatBusinessDateKey(task.endTime) === todayKey.value;
};
const isTodoFutureTask = (task) => {
    if (!isTodoTask(task))
        return false;
    if (!task.endTime)
        return true;
    return formatBusinessDateKey(task.endTime) !== todayKey.value;
};
const buildTree = (tasks) => {
    const nodeMap = new Map();
    const roots = [];
    tasks.forEach((task) => {
        nodeMap.set(task.taskId, { ...task, children: [] });
    });
    tasks.forEach((task) => {
        const current = nodeMap.get(task.taskId);
        const parentId = task.parentId ?? null;
        if (parentId && nodeMap.has(parentId)) {
            nodeMap.get(parentId).children.push(current);
        }
        else {
            roots.push(current);
        }
    });
    return sortTree(roots);
};
const sortTree = (nodes) => {
    nodes.sort((left, right) => {
        const typeDiff = taskOrderRank(left) - taskOrderRank(right);
        if (typeDiff !== 0)
            return typeDiff;
        return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
    });
    nodes.forEach((node) => {
        if (node.children?.length) {
            node.children = sortTree(node.children);
        }
    });
    return nodes;
};
const filterSceneTree = (nodes) => {
    return nodes.reduce((accumulator, node) => {
        if (isScene(node)) {
            accumulator.push({
                ...node,
                children: node.children ? filterSceneTree(node.children) : [],
            });
            return accumulator;
        }
        if (node.children?.length) {
            accumulator.push(...filterSceneTree(node.children));
        }
        return accumulator;
    }, []);
};
const filterNonSceneTree = (nodes) => {
    return nodes.reduce((accumulator, node) => {
        if (isScene(node))
            return accumulator;
        accumulator.push({
            ...node,
            children: node.children ? filterNonSceneTree(node.children) : [],
        });
        return accumulator;
    }, []);
};
const taskOrderRank = (task) => {
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
const filterTree = (nodes, predicate) => {
    return nodes.reduce((accumulator, node) => {
        const filteredChildren = node.children ? filterTree(node.children, predicate) : [];
        if (predicate(node) || filteredChildren.length > 0) {
            accumulator.push({ ...node, children: filteredChildren });
        }
        return accumulator;
    }, []);
};
const countTree = (nodes, predicate) => {
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
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['logout-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['logout-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['content-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['content-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['content-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-title']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__content']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-enable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-disable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-revoke']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-complete']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-enable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-disable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-revoke']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-complete']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-enable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-disable']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-revoke']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-complete']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__children']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__children']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-top']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-top']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog']} */ ;
/** @type {__VLS_StyleScopedClasses['view-mode']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-parent-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['review-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['home-shell']} */ ;
/** @type {__VLS_StyleScopedClasses['sidebar']} */ ;
/** @type {__VLS_StyleScopedClasses['content-area']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['content-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['section-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-grid']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "home-shell" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.aside, __VLS_intrinsicElements.aside)({
    ...{ class: "sidebar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "brand" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "brand-mark" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "brand-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "user-card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "user-card-icon" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "user-card-content" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "user-card-name" },
});
(__VLS_ctx.displayUsername);
__VLS_asFunctionalElement(__VLS_intrinsicElements.nav, __VLS_intrinsicElements.nav)({
    ...{ class: "nav-list" },
});
for (const [item] of __VLS_getVForSourceType((__VLS_ctx.sectionItems))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.setActiveSection(item.key);
            } },
        key: (item.key),
        ...{ class: "nav-item" },
        ...{ class: ({ active: __VLS_ctx.activeSection === item.key }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (item.label);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.small, __VLS_intrinsicElements.small)({});
    (item.countLabel);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "sidebar-bottom" },
});
const __VLS_0 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onClick': {} },
    ...{ class: "logout-btn" },
    type: "warning",
    plain: true,
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClick': {} },
    ...{ class: "logout-btn" },
    type: "warning",
    plain: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onClick: (__VLS_ctx.handleLogout)
};
__VLS_3.slots.default;
var __VLS_3;
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "content-area" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
    ...{ class: "content-topbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
(__VLS_ctx.activeSectionTitle);
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
(__VLS_ctx.todayLabel);
if (__VLS_ctx.activeSection === 'today') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-toolbar section-toolbar-left" },
    });
    const __VLS_8 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_10 = __VLS_9({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_9));
    let __VLS_12;
    let __VLS_13;
    let __VLS_14;
    const __VLS_15 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.activeSection === 'today'))
                return;
            __VLS_ctx.openCreateTaskDialog();
        }
    };
    __VLS_11.slots.default;
    var __VLS_11;
    const __VLS_16 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_18 = __VLS_17({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_17));
    let __VLS_20;
    let __VLS_21;
    let __VLS_22;
    const __VLS_23 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_19.slots.default;
    var __VLS_19;
}
if (__VLS_ctx.activeSection === 'today') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "panel-card" },
    });
    if (!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_24 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
            description: "当前没有今日任务",
        }));
        const __VLS_26 = __VLS_25({
            description: "当前没有今日任务",
        }, ...__VLS_functionalComponentArgsRest(__VLS_25));
    }
    else {
        const __VLS_28 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_30 = __VLS_29({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        __VLS_31.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_31.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'today'))
                            return;
                        if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.openViewTaskDialog(data);
                    } },
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            if (String(data.type) === '1') {
                const __VLS_32 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_34 = __VLS_33({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_33));
                __VLS_35.slots.default;
                const __VLS_36 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({}));
                const __VLS_38 = __VLS_37({}, ...__VLS_functionalComponentArgsRest(__VLS_37));
                var __VLS_35;
            }
            else if (String(data.type) === '2') {
                const __VLS_40 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_42 = __VLS_41({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_41));
                __VLS_43.slots.default;
                const __VLS_44 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({}));
                const __VLS_46 = __VLS_45({}, ...__VLS_functionalComponentArgsRest(__VLS_45));
                var __VLS_43;
            }
            else {
                const __VLS_48 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_50 = __VLS_49({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_49));
                __VLS_51.slots.default;
                const __VLS_52 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({}));
                const __VLS_54 = __VLS_53({}, ...__VLS_functionalComponentArgsRest(__VLS_53));
                var __VLS_51;
            }
            const __VLS_56 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_58 = __VLS_57({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_57));
            __VLS_59.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_59;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-node-desc" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'today'))
                            return;
                        if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.toggleRunStatus(data);
                    } },
                type: "button",
                ...{ class: "task-run-toggle" },
            });
            const __VLS_60 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_61 = __VLS_asFunctionalComponent(__VLS_60, new __VLS_60({}));
            const __VLS_62 = __VLS_61({}, ...__VLS_functionalComponentArgsRest(__VLS_61));
            __VLS_63.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_64 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({}));
                const __VLS_66 = __VLS_65({}, ...__VLS_functionalComponentArgsRest(__VLS_65));
            }
            else {
                const __VLS_68 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_69 = __VLS_asFunctionalComponent(__VLS_68, new __VLS_68({}));
                const __VLS_70 = __VLS_69({}, ...__VLS_functionalComponentArgsRest(__VLS_69));
            }
            var __VLS_63;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_72 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (6),
                color: ('#93c5fd'),
            }));
            const __VLS_74 = __VLS_73({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (6),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_73));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "clock-progress-text" },
            });
            (__VLS_ctx.clockLabel(data));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_76 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_77 = __VLS_asFunctionalComponent(__VLS_76, new __VLS_76({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_78 = __VLS_77({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_77));
            let __VLS_80;
            let __VLS_81;
            let __VLS_82;
            const __VLS_83 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_79.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_79;
            const __VLS_84 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_85 = __VLS_asFunctionalComponent(__VLS_84, new __VLS_84({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_86 = __VLS_85({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_85));
            let __VLS_88;
            let __VLS_89;
            let __VLS_90;
            const __VLS_91 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_87.slots.default;
            var __VLS_87;
            const __VLS_92 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_93 = __VLS_asFunctionalComponent(__VLS_92, new __VLS_92({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_94 = __VLS_93({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_93));
            let __VLS_96;
            let __VLS_97;
            let __VLS_98;
            const __VLS_99 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_95.slots.default;
            var __VLS_95;
            const __VLS_100 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_101 = __VLS_asFunctionalComponent(__VLS_100, new __VLS_100({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_102 = __VLS_101({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_101));
            let __VLS_104;
            let __VLS_105;
            let __VLS_106;
            const __VLS_107 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_103.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_103;
            const __VLS_108 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_109 = __VLS_asFunctionalComponent(__VLS_108, new __VLS_108({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_110 = __VLS_109({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_109));
            let __VLS_112;
            let __VLS_113;
            let __VLS_114;
            const __VLS_115 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_111.slots.default;
            var __VLS_111;
        }
        var __VLS_31;
    }
}
if (__VLS_ctx.activeSection === 'todo') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-toolbar section-toolbar-left" },
    });
    const __VLS_116 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_117 = __VLS_asFunctionalComponent(__VLS_116, new __VLS_116({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_118 = __VLS_117({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_117));
    let __VLS_120;
    let __VLS_121;
    let __VLS_122;
    const __VLS_123 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.activeSection === 'todo'))
                return;
            __VLS_ctx.openCreateTaskDialog();
        }
    };
    __VLS_119.slots.default;
    var __VLS_119;
    const __VLS_124 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_125 = __VLS_asFunctionalComponent(__VLS_124, new __VLS_124({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_126 = __VLS_125({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_125));
    let __VLS_128;
    let __VLS_129;
    let __VLS_130;
    const __VLS_131 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_127.slots.default;
    var __VLS_127;
}
if (__VLS_ctx.activeSection === 'todo') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "task-split-layout" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card task-split-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head panel-head-stacked panel-head-actions-left" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-title" },
    });
    if (!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_132 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_133 = __VLS_asFunctionalComponent(__VLS_132, new __VLS_132({
            description: "当前没有今日待办",
        }));
        const __VLS_134 = __VLS_133({
            description: "当前没有今日待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_133));
    }
    else {
        const __VLS_136 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_137 = __VLS_asFunctionalComponent(__VLS_136, new __VLS_136({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_138 = __VLS_137({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_137));
        __VLS_139.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_139.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.openViewTaskDialog(data);
                    } },
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            if (String(data.type) === '1') {
                const __VLS_140 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_141 = __VLS_asFunctionalComponent(__VLS_140, new __VLS_140({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_142 = __VLS_141({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_141));
                __VLS_143.slots.default;
                const __VLS_144 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({}));
                const __VLS_146 = __VLS_145({}, ...__VLS_functionalComponentArgsRest(__VLS_145));
                var __VLS_143;
            }
            else if (String(data.type) === '2') {
                const __VLS_148 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_149 = __VLS_asFunctionalComponent(__VLS_148, new __VLS_148({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_150 = __VLS_149({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_149));
                __VLS_151.slots.default;
                const __VLS_152 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_153 = __VLS_asFunctionalComponent(__VLS_152, new __VLS_152({}));
                const __VLS_154 = __VLS_153({}, ...__VLS_functionalComponentArgsRest(__VLS_153));
                var __VLS_151;
            }
            else {
                const __VLS_156 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_157 = __VLS_asFunctionalComponent(__VLS_156, new __VLS_156({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_158 = __VLS_157({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_157));
                __VLS_159.slots.default;
                const __VLS_160 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_161 = __VLS_asFunctionalComponent(__VLS_160, new __VLS_160({}));
                const __VLS_162 = __VLS_161({}, ...__VLS_functionalComponentArgsRest(__VLS_161));
                var __VLS_159;
            }
            const __VLS_164 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_165 = __VLS_asFunctionalComponent(__VLS_164, new __VLS_164({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_166 = __VLS_165({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_165));
            __VLS_167.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_167;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-node-desc" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.toggleRunStatus(data);
                    } },
                type: "button",
                ...{ class: "task-run-toggle" },
            });
            const __VLS_168 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({}));
            const __VLS_170 = __VLS_169({}, ...__VLS_functionalComponentArgsRest(__VLS_169));
            __VLS_171.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_172 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_173 = __VLS_asFunctionalComponent(__VLS_172, new __VLS_172({}));
                const __VLS_174 = __VLS_173({}, ...__VLS_functionalComponentArgsRest(__VLS_173));
            }
            else {
                const __VLS_176 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_177 = __VLS_asFunctionalComponent(__VLS_176, new __VLS_176({}));
                const __VLS_178 = __VLS_177({}, ...__VLS_functionalComponentArgsRest(__VLS_177));
            }
            var __VLS_171;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_180 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_181 = __VLS_asFunctionalComponent(__VLS_180, new __VLS_180({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_182 = __VLS_181({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_181));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "clock-progress-text" },
            });
            (__VLS_ctx.clockLabel(data));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_184 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_185 = __VLS_asFunctionalComponent(__VLS_184, new __VLS_184({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_186 = __VLS_185({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_185));
            let __VLS_188;
            let __VLS_189;
            let __VLS_190;
            const __VLS_191 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_187.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_187;
            const __VLS_192 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_194 = __VLS_193({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_193));
            let __VLS_196;
            let __VLS_197;
            let __VLS_198;
            const __VLS_199 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_195.slots.default;
            var __VLS_195;
            const __VLS_200 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_202 = __VLS_201({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_201));
            let __VLS_204;
            let __VLS_205;
            let __VLS_206;
            const __VLS_207 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_203.slots.default;
            var __VLS_203;
            const __VLS_208 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_209 = __VLS_asFunctionalComponent(__VLS_208, new __VLS_208({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_210 = __VLS_209({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_209));
            let __VLS_212;
            let __VLS_213;
            let __VLS_214;
            const __VLS_215 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_211.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_211;
            const __VLS_216 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_218 = __VLS_217({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_217));
            let __VLS_220;
            let __VLS_221;
            let __VLS_222;
            const __VLS_223 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_219.slots.default;
            var __VLS_219;
        }
        var __VLS_139;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card task-split-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head panel-head-stacked panel-head-actions-left" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-title" },
    });
    if (!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_224 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_225 = __VLS_asFunctionalComponent(__VLS_224, new __VLS_224({
            description: "当前没有后续待办",
        }));
        const __VLS_226 = __VLS_225({
            description: "当前没有后续待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_225));
    }
    else {
        const __VLS_228 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_229 = __VLS_asFunctionalComponent(__VLS_228, new __VLS_228({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_230 = __VLS_229({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_229));
        __VLS_231.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_231.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.openViewTaskDialog(data);
                    } },
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            if (String(data.type) === '1') {
                const __VLS_232 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_233 = __VLS_asFunctionalComponent(__VLS_232, new __VLS_232({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_234 = __VLS_233({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_233));
                __VLS_235.slots.default;
                const __VLS_236 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_237 = __VLS_asFunctionalComponent(__VLS_236, new __VLS_236({}));
                const __VLS_238 = __VLS_237({}, ...__VLS_functionalComponentArgsRest(__VLS_237));
                var __VLS_235;
            }
            else if (String(data.type) === '2') {
                const __VLS_240 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_242 = __VLS_241({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_241));
                __VLS_243.slots.default;
                const __VLS_244 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_245 = __VLS_asFunctionalComponent(__VLS_244, new __VLS_244({}));
                const __VLS_246 = __VLS_245({}, ...__VLS_functionalComponentArgsRest(__VLS_245));
                var __VLS_243;
            }
            else {
                const __VLS_248 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_249 = __VLS_asFunctionalComponent(__VLS_248, new __VLS_248({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_250 = __VLS_249({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_249));
                __VLS_251.slots.default;
                const __VLS_252 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_253 = __VLS_asFunctionalComponent(__VLS_252, new __VLS_252({}));
                const __VLS_254 = __VLS_253({}, ...__VLS_functionalComponentArgsRest(__VLS_253));
                var __VLS_251;
            }
            const __VLS_256 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_257 = __VLS_asFunctionalComponent(__VLS_256, new __VLS_256({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_258 = __VLS_257({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_257));
            __VLS_259.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_259;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.toggleRunStatus(data);
                    } },
                type: "button",
                ...{ class: "task-run-toggle" },
            });
            const __VLS_260 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_261 = __VLS_asFunctionalComponent(__VLS_260, new __VLS_260({}));
            const __VLS_262 = __VLS_261({}, ...__VLS_functionalComponentArgsRest(__VLS_261));
            __VLS_263.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_264 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_265 = __VLS_asFunctionalComponent(__VLS_264, new __VLS_264({}));
                const __VLS_266 = __VLS_265({}, ...__VLS_functionalComponentArgsRest(__VLS_265));
            }
            else {
                const __VLS_268 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_269 = __VLS_asFunctionalComponent(__VLS_268, new __VLS_268({}));
                const __VLS_270 = __VLS_269({}, ...__VLS_functionalComponentArgsRest(__VLS_269));
            }
            var __VLS_263;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_272 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_273 = __VLS_asFunctionalComponent(__VLS_272, new __VLS_272({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_274 = __VLS_273({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_273));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "clock-progress-text" },
            });
            (__VLS_ctx.clockLabel(data));
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_276 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_277 = __VLS_asFunctionalComponent(__VLS_276, new __VLS_276({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_278 = __VLS_277({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_277));
            let __VLS_280;
            let __VLS_281;
            let __VLS_282;
            const __VLS_283 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_279.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_279;
            const __VLS_284 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_285 = __VLS_asFunctionalComponent(__VLS_284, new __VLS_284({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_286 = __VLS_285({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_285));
            let __VLS_288;
            let __VLS_289;
            let __VLS_290;
            const __VLS_291 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_287.slots.default;
            var __VLS_287;
            const __VLS_292 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_293 = __VLS_asFunctionalComponent(__VLS_292, new __VLS_292({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_294 = __VLS_293({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_293));
            let __VLS_296;
            let __VLS_297;
            let __VLS_298;
            const __VLS_299 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_295.slots.default;
            var __VLS_295;
            const __VLS_300 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_301 = __VLS_asFunctionalComponent(__VLS_300, new __VLS_300({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_302 = __VLS_301({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_301));
            let __VLS_304;
            let __VLS_305;
            let __VLS_306;
            const __VLS_307 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_303.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_303;
            const __VLS_308 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_309 = __VLS_asFunctionalComponent(__VLS_308, new __VLS_308({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_310 = __VLS_309({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_309));
            let __VLS_312;
            let __VLS_313;
            let __VLS_314;
            const __VLS_315 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_311.slots.default;
            var __VLS_311;
        }
        var __VLS_231;
    }
}
else if (__VLS_ctx.activeSection === 'all') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "task-split-layout" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card task-split-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head panel-head-stacked panel-head-actions-left" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-actions" },
    });
    const __VLS_316 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_317 = __VLS_asFunctionalComponent(__VLS_316, new __VLS_316({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_318 = __VLS_317({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_317));
    let __VLS_320;
    let __VLS_321;
    let __VLS_322;
    const __VLS_323 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateSceneDialog();
        }
    };
    __VLS_319.slots.default;
    var __VLS_319;
    const __VLS_324 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_325 = __VLS_asFunctionalComponent(__VLS_324, new __VLS_324({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_326 = __VLS_325({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_325));
    let __VLS_328;
    let __VLS_329;
    let __VLS_330;
    const __VLS_331 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_327.slots.default;
    var __VLS_327;
    if (!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_332 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_333 = __VLS_asFunctionalComponent(__VLS_332, new __VLS_332({
            description: "当前没有场景",
        }));
        const __VLS_334 = __VLS_333({
            description: "当前没有场景",
        }, ...__VLS_functionalComponentArgsRest(__VLS_333));
    }
    else {
        const __VLS_336 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_337 = __VLS_asFunctionalComponent(__VLS_336, new __VLS_336({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_338 = __VLS_337({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_337));
        __VLS_339.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_339.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!(__VLS_ctx.activeSection === 'all'))
                            return;
                        if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.openViewTaskDialog(data);
                    } },
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            if (String(data.type) === '1') {
                const __VLS_340 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_341 = __VLS_asFunctionalComponent(__VLS_340, new __VLS_340({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_342 = __VLS_341({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_341));
                __VLS_343.slots.default;
                const __VLS_344 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_345 = __VLS_asFunctionalComponent(__VLS_344, new __VLS_344({}));
                const __VLS_346 = __VLS_345({}, ...__VLS_functionalComponentArgsRest(__VLS_345));
                var __VLS_343;
            }
            else if (String(data.type) === '2') {
                const __VLS_348 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_349 = __VLS_asFunctionalComponent(__VLS_348, new __VLS_348({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_350 = __VLS_349({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_349));
                __VLS_351.slots.default;
                const __VLS_352 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_353 = __VLS_asFunctionalComponent(__VLS_352, new __VLS_352({}));
                const __VLS_354 = __VLS_353({}, ...__VLS_functionalComponentArgsRest(__VLS_353));
                var __VLS_351;
            }
            else {
                const __VLS_356 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_357 = __VLS_asFunctionalComponent(__VLS_356, new __VLS_356({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_358 = __VLS_357({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_357));
                __VLS_359.slots.default;
                const __VLS_360 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_361 = __VLS_asFunctionalComponent(__VLS_360, new __VLS_360({}));
                const __VLS_362 = __VLS_361({}, ...__VLS_functionalComponentArgsRest(__VLS_361));
                var __VLS_359;
            }
            const __VLS_364 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_365 = __VLS_asFunctionalComponent(__VLS_364, new __VLS_364({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_366 = __VLS_365({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_365));
            __VLS_367.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_367;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-node-desc" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            const __VLS_368 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_369 = __VLS_asFunctionalComponent(__VLS_368, new __VLS_368({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_370 = __VLS_369({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_369));
            let __VLS_372;
            let __VLS_373;
            let __VLS_374;
            const __VLS_375 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data, false);
                }
            };
            __VLS_371.slots.default;
            var __VLS_371;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!(__VLS_ctx.activeSection === 'all'))
                            return;
                        if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.toggleRunStatus(data);
                    } },
                type: "button",
                ...{ class: "task-run-toggle" },
            });
            const __VLS_376 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_377 = __VLS_asFunctionalComponent(__VLS_376, new __VLS_376({}));
            const __VLS_378 = __VLS_377({}, ...__VLS_functionalComponentArgsRest(__VLS_377));
            __VLS_379.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_380 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_381 = __VLS_asFunctionalComponent(__VLS_380, new __VLS_380({}));
                const __VLS_382 = __VLS_381({}, ...__VLS_functionalComponentArgsRest(__VLS_381));
            }
            else {
                const __VLS_384 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_385 = __VLS_asFunctionalComponent(__VLS_384, new __VLS_384({}));
                const __VLS_386 = __VLS_385({}, ...__VLS_functionalComponentArgsRest(__VLS_385));
            }
            var __VLS_379;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_388 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_389 = __VLS_asFunctionalComponent(__VLS_388, new __VLS_388({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_390 = __VLS_389({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_389));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "clock-progress-text" },
            });
            (__VLS_ctx.clockLabel(data));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_392 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_393 = __VLS_asFunctionalComponent(__VLS_392, new __VLS_392({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_394 = __VLS_393({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_393));
            let __VLS_396;
            let __VLS_397;
            let __VLS_398;
            const __VLS_399 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_395.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_395;
            const __VLS_400 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_401 = __VLS_asFunctionalComponent(__VLS_400, new __VLS_400({
                ...{ 'onClick': {} },
                size: "small",
                type: (data.active ? 'warning' : 'primary'),
            }));
            const __VLS_402 = __VLS_401({
                ...{ 'onClick': {} },
                size: "small",
                type: (data.active ? 'warning' : 'primary'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_401));
            let __VLS_404;
            let __VLS_405;
            let __VLS_406;
            const __VLS_407 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_403.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_403;
            const __VLS_408 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_409 = __VLS_asFunctionalComponent(__VLS_408, new __VLS_408({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_410 = __VLS_409({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_409));
            let __VLS_412;
            let __VLS_413;
            let __VLS_414;
            const __VLS_415 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_411.slots.default;
            var __VLS_411;
            const __VLS_416 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_417 = __VLS_asFunctionalComponent(__VLS_416, new __VLS_416({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_418 = __VLS_417({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_417));
            let __VLS_420;
            let __VLS_421;
            let __VLS_422;
            const __VLS_423 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_419.slots.default;
            var __VLS_419;
        }
        var __VLS_339;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card task-split-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head panel-head-stacked panel-head-actions-left" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-actions" },
    });
    const __VLS_424 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_425 = __VLS_asFunctionalComponent(__VLS_424, new __VLS_424({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_426 = __VLS_425({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_425));
    let __VLS_428;
    let __VLS_429;
    let __VLS_430;
    const __VLS_431 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateTaskDialog(null, false);
        }
    };
    __VLS_427.slots.default;
    var __VLS_427;
    const __VLS_432 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_433 = __VLS_asFunctionalComponent(__VLS_432, new __VLS_432({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_434 = __VLS_433({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_433));
    let __VLS_436;
    let __VLS_437;
    let __VLS_438;
    const __VLS_439 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_435.slots.default;
    var __VLS_435;
    if (!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_440 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_441 = __VLS_asFunctionalComponent(__VLS_440, new __VLS_440({
            description: "当前没有非场景任务",
        }));
        const __VLS_442 = __VLS_441({
            description: "当前没有非场景任务",
        }, ...__VLS_functionalComponentArgsRest(__VLS_441));
    }
    else {
        const __VLS_444 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_445 = __VLS_asFunctionalComponent(__VLS_444, new __VLS_444({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_446 = __VLS_445({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_445));
        __VLS_447.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_447.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!(__VLS_ctx.activeSection === 'all'))
                            return;
                        if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.openViewTaskDialog(data);
                    } },
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            if (String(data.type) === '1') {
                const __VLS_448 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_449 = __VLS_asFunctionalComponent(__VLS_448, new __VLS_448({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_450 = __VLS_449({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_449));
                __VLS_451.slots.default;
                const __VLS_452 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_453 = __VLS_asFunctionalComponent(__VLS_452, new __VLS_452({}));
                const __VLS_454 = __VLS_453({}, ...__VLS_functionalComponentArgsRest(__VLS_453));
                var __VLS_451;
            }
            else if (String(data.type) === '2') {
                const __VLS_456 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_457 = __VLS_asFunctionalComponent(__VLS_456, new __VLS_456({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_458 = __VLS_457({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_457));
                __VLS_459.slots.default;
                const __VLS_460 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_461 = __VLS_asFunctionalComponent(__VLS_460, new __VLS_460({}));
                const __VLS_462 = __VLS_461({}, ...__VLS_functionalComponentArgsRest(__VLS_461));
                var __VLS_459;
            }
            else {
                const __VLS_464 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_465 = __VLS_asFunctionalComponent(__VLS_464, new __VLS_464({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_466 = __VLS_465({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_465));
                __VLS_467.slots.default;
                const __VLS_468 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_469 = __VLS_asFunctionalComponent(__VLS_468, new __VLS_468({}));
                const __VLS_470 = __VLS_469({}, ...__VLS_functionalComponentArgsRest(__VLS_469));
                var __VLS_467;
            }
            const __VLS_472 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_473 = __VLS_asFunctionalComponent(__VLS_472, new __VLS_472({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_474 = __VLS_473({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_473));
            __VLS_475.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_475;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-node-desc" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.activeSection === 'todo'))
                            return;
                        if (!(__VLS_ctx.activeSection === 'all'))
                            return;
                        if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                            return;
                        __VLS_ctx.toggleRunStatus(data);
                    } },
                type: "button",
                ...{ class: "task-run-toggle" },
            });
            const __VLS_476 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_477 = __VLS_asFunctionalComponent(__VLS_476, new __VLS_476({}));
            const __VLS_478 = __VLS_477({}, ...__VLS_functionalComponentArgsRest(__VLS_477));
            __VLS_479.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_480 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_481 = __VLS_asFunctionalComponent(__VLS_480, new __VLS_480({}));
                const __VLS_482 = __VLS_481({}, ...__VLS_functionalComponentArgsRest(__VLS_481));
            }
            else {
                const __VLS_484 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_485 = __VLS_asFunctionalComponent(__VLS_484, new __VLS_484({}));
                const __VLS_486 = __VLS_485({}, ...__VLS_functionalComponentArgsRest(__VLS_485));
            }
            var __VLS_479;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_488 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_489 = __VLS_asFunctionalComponent(__VLS_488, new __VLS_488({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_490 = __VLS_489({
                percentage: (__VLS_ctx.progressPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_489));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "clock-progress-text" },
            });
            (__VLS_ctx.clockLabel(data));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_492 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_493 = __VLS_asFunctionalComponent(__VLS_492, new __VLS_492({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_494 = __VLS_493({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_493));
            let __VLS_496;
            let __VLS_497;
            let __VLS_498;
            const __VLS_499 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_495.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_495;
            const __VLS_500 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_501 = __VLS_asFunctionalComponent(__VLS_500, new __VLS_500({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_502 = __VLS_501({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_501));
            let __VLS_504;
            let __VLS_505;
            let __VLS_506;
            const __VLS_507 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_503.slots.default;
            var __VLS_503;
            const __VLS_508 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_509 = __VLS_asFunctionalComponent(__VLS_508, new __VLS_508({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_510 = __VLS_509({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_509));
            let __VLS_512;
            let __VLS_513;
            let __VLS_514;
            const __VLS_515 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_511.slots.default;
            var __VLS_511;
            const __VLS_516 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_517 = __VLS_asFunctionalComponent(__VLS_516, new __VLS_516({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_518 = __VLS_517({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_517));
            let __VLS_520;
            let __VLS_521;
            let __VLS_522;
            const __VLS_523 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_519.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_519;
            const __VLS_524 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_525 = __VLS_asFunctionalComponent(__VLS_524, new __VLS_524({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_526 = __VLS_525({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_525));
            let __VLS_528;
            let __VLS_529;
            let __VLS_530;
            const __VLS_531 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!(__VLS_ctx.activeSection === 'all'))
                        return;
                    if (!!(!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_527.slots.default;
            var __VLS_527;
        }
        var __VLS_447;
    }
}
if (__VLS_ctx.activeSection === 'review') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "review-layout" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card review-editor-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head-actions" },
    });
    const __VLS_532 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_533 = __VLS_asFunctionalComponent(__VLS_532, new __VLS_532({
        ...{ 'onClick': {} },
        plain: true,
    }));
    const __VLS_534 = __VLS_533({
        ...{ 'onClick': {} },
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_533));
    let __VLS_536;
    let __VLS_537;
    let __VLS_538;
    const __VLS_539 = {
        onClick: (__VLS_ctx.saveDraft)
    };
    __VLS_535.slots.default;
    var __VLS_535;
    const __VLS_540 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_541 = __VLS_asFunctionalComponent(__VLS_540, new __VLS_540({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }));
    const __VLS_542 = __VLS_541({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }, ...__VLS_functionalComponentArgsRest(__VLS_541));
    let __VLS_544;
    let __VLS_545;
    let __VLS_546;
    const __VLS_547 = {
        onClick: (__VLS_ctx.saveReviewToServer)
    };
    __VLS_543.slots.default;
    var __VLS_543;
    const __VLS_548 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_549 = __VLS_asFunctionalComponent(__VLS_548, new __VLS_548({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }));
    const __VLS_550 = __VLS_549({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }, ...__VLS_functionalComponentArgsRest(__VLS_549));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "review-tips" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "review-grid" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card review-history-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    const __VLS_552 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_553 = __VLS_asFunctionalComponent(__VLS_552, new __VLS_552({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }));
    const __VLS_554 = __VLS_553({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_553));
    let __VLS_556;
    let __VLS_557;
    let __VLS_558;
    const __VLS_559 = {
        onClick: (__VLS_ctx.loadReviews)
    };
    __VLS_555.slots.default;
    var __VLS_555;
    if (!__VLS_ctx.reviewHistory.length) {
        const __VLS_560 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_561 = __VLS_asFunctionalComponent(__VLS_560, new __VLS_560({
            description: "还没有历史回顾",
        }));
        const __VLS_562 = __VLS_561({
            description: "还没有历史回顾",
        }, ...__VLS_functionalComponentArgsRest(__VLS_561));
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "review-list" },
        });
        for (const [item] of __VLS_getVForSourceType((__VLS_ctx.reviewHistory))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.activeSection === 'review'))
                            return;
                        if (!!(!__VLS_ctx.reviewHistory.length))
                            return;
                        __VLS_ctx.selectReview(item);
                    } },
                key: (item.reviewId),
                ...{ class: "review-item" },
                ...{ class: ({ active: __VLS_ctx.selectedReview?.reviewId === item.reviewId }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "review-item-top" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
            (__VLS_ctx.formatDateOnly(item.date));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
            (item.doneCount ?? 0);
            (item.totalCount ?? 0);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "review-item-snippet" },
            });
            (__VLS_ctx.reviewSnippet(item.content));
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-card review-detail-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "panel-head" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
    if (__VLS_ctx.selectedReview) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
        (__VLS_ctx.formatDateOnly(__VLS_ctx.selectedReview.date));
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    }
    if (__VLS_ctx.selectedReview) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-grid" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
        (__VLS_ctx.selectedReview.doneCount ?? 0);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
        (__VLS_ctx.selectedReview.totalCount ?? 0);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
        (__VLS_ctx.formatDuration(__VLS_ctx.selectedReview.netFocusTime));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-item" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
        (__VLS_ctx.formatDuration(__VLS_ctx.selectedReview.actualDurationSum));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
            ...{ class: "detail-pre" },
        });
        (__VLS_ctx.selectedReview.content || '暂无内容');
        if (__VLS_ctx.selectedReview.timeDistribution) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "detail-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "detail-block-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                ...{ class: "detail-pre" },
            });
            (__VLS_ctx.prettyJson(__VLS_ctx.selectedReview.timeDistribution));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-footer" },
        });
        const __VLS_564 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_565 = __VLS_asFunctionalComponent(__VLS_564, new __VLS_564({
            type: "warning",
        }));
        const __VLS_566 = __VLS_565({
            type: "warning",
        }, ...__VLS_functionalComponentArgsRest(__VLS_565));
        __VLS_567.slots.default;
        (__VLS_ctx.selectedReview.streakDays ?? 0);
        var __VLS_567;
        const __VLS_568 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_569 = __VLS_asFunctionalComponent(__VLS_568, new __VLS_568({
            type: "info",
        }));
        const __VLS_570 = __VLS_569({
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_569));
        __VLS_571.slots.default;
        (__VLS_ctx.formatDuration(__VLS_ctx.selectedReview.grossEffort));
        var __VLS_571;
    }
    else {
        const __VLS_572 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_573 = __VLS_asFunctionalComponent(__VLS_572, new __VLS_572({
            description: "请选择一条历史 review",
        }));
        const __VLS_574 = __VLS_573({
            description: "请选择一条历史 review",
        }, ...__VLS_functionalComponentArgsRest(__VLS_573));
    }
}
const __VLS_576 = {}.ElDialog;
/** @type {[typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, ]} */ ;
// @ts-ignore
const __VLS_577 = __VLS_asFunctionalComponent(__VLS_576, new __VLS_576({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: (['task-dialog', { 'view-mode': __VLS_ctx.taskDialogMode === 'view' }]) },
    destroyOnClose: true,
    appendToBody: true,
}));
const __VLS_578 = __VLS_577({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: (['task-dialog', { 'view-mode': __VLS_ctx.taskDialogMode === 'view' }]) },
    destroyOnClose: true,
    appendToBody: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_577));
let __VLS_580;
let __VLS_581;
let __VLS_582;
const __VLS_583 = {
    onClosed: (__VLS_ctx.resetTaskDialog)
};
__VLS_579.slots.default;
if (__VLS_ctx.taskDialogMode !== 'view' && !__VLS_ctx.isSceneDialog) {
    const __VLS_584 = {}.ElSteps;
    /** @type {[typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, ]} */ ;
    // @ts-ignore
    const __VLS_585 = __VLS_asFunctionalComponent(__VLS_584, new __VLS_584({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }));
    const __VLS_586 = __VLS_585({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_585));
    __VLS_587.slots.default;
    const __VLS_588 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_589 = __VLS_asFunctionalComponent(__VLS_588, new __VLS_588({
        title: "基本信息",
    }));
    const __VLS_590 = __VLS_589({
        title: "基本信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_589));
    const __VLS_592 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_593 = __VLS_asFunctionalComponent(__VLS_592, new __VLS_592({
        title: "时间信息",
    }));
    const __VLS_594 = __VLS_593({
        title: "时间信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_593));
    var __VLS_587;
}
if (__VLS_ctx.taskDialogMode !== 'view' && __VLS_ctx.taskDialogParent) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-parent-chip" },
    });
    if (String(__VLS_ctx.taskDialogParent.type) === '1') {
        const __VLS_596 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_597 = __VLS_asFunctionalComponent(__VLS_596, new __VLS_596({
            ...{ class: "task-type-icon task-type-icon-recurring" },
        }));
        const __VLS_598 = __VLS_597({
            ...{ class: "task-type-icon task-type-icon-recurring" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_597));
        __VLS_599.slots.default;
        const __VLS_600 = {}.Clock;
        /** @type {[typeof __VLS_components.Clock, ]} */ ;
        // @ts-ignore
        const __VLS_601 = __VLS_asFunctionalComponent(__VLS_600, new __VLS_600({}));
        const __VLS_602 = __VLS_601({}, ...__VLS_functionalComponentArgsRest(__VLS_601));
        var __VLS_599;
    }
    else if (String(__VLS_ctx.taskDialogParent.type) === '2') {
        const __VLS_604 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_605 = __VLS_asFunctionalComponent(__VLS_604, new __VLS_604({
            ...{ class: "task-type-icon task-type-icon-ddl" },
        }));
        const __VLS_606 = __VLS_605({
            ...{ class: "task-type-icon task-type-icon-ddl" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_605));
        __VLS_607.slots.default;
        const __VLS_608 = {}.Calendar;
        /** @type {[typeof __VLS_components.Calendar, ]} */ ;
        // @ts-ignore
        const __VLS_609 = __VLS_asFunctionalComponent(__VLS_608, new __VLS_608({}));
        const __VLS_610 = __VLS_609({}, ...__VLS_functionalComponentArgsRest(__VLS_609));
        var __VLS_607;
    }
    else {
        const __VLS_612 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_613 = __VLS_asFunctionalComponent(__VLS_612, new __VLS_612({
            ...{ class: "task-type-icon task-type-icon-note" },
        }));
        const __VLS_614 = __VLS_613({
            ...{ class: "task-type-icon task-type-icon-note" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_613));
        __VLS_615.slots.default;
        const __VLS_616 = {}.Document;
        /** @type {[typeof __VLS_components.Document, ]} */ ;
        // @ts-ignore
        const __VLS_617 = __VLS_asFunctionalComponent(__VLS_616, new __VLS_616({}));
        const __VLS_618 = __VLS_617({}, ...__VLS_functionalComponentArgsRest(__VLS_617));
        var __VLS_615;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.taskDialogParent.title);
}
if (__VLS_ctx.taskDialogMode !== 'view') {
    for (const [warning] of __VLS_getVForSourceType((__VLS_ctx.taskDialogWarnings))) {
        const __VLS_620 = {}.ElAlert;
        /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
        // @ts-ignore
        const __VLS_621 = __VLS_asFunctionalComponent(__VLS_620, new __VLS_620({
            key: (warning),
            title: (warning),
            type: "warning",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }));
        const __VLS_622 = __VLS_621({
            key: (warning),
            title: (warning),
            type: "warning",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_621));
    }
}
if (__VLS_ctx.taskDialogMode === 'view') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-page read-only-view" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-block-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "detail-text" },
    });
    (__VLS_ctx.taskForm.description || '无');
    if (String(__VLS_ctx.taskForm.type) === '2') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.endTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.endTime) : '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatPlannedDuration(__VLS_ctx.taskForm.targetDuration));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.startTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.startTime) : '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.settlementTypeOptions.find(o => o.value === __VLS_ctx.taskForm.settlementType)?.label || '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.createTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.createTime) : '-');
    }
    else if (__VLS_ctx.isRecurringTask) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatRecurrence(__VLS_ctx.taskForm.cycleMode, __VLS_ctx.taskForm.cycleIntervalDays, __VLS_ctx.taskForm.cycleWeekdays, __VLS_ctx.taskForm.cycleMonthDays));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatPlannedDuration(__VLS_ctx.taskForm.targetDuration));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatTimeOnly(__VLS_ctx.taskForm.startTime));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatTimeOnly(__VLS_ctx.taskForm.endTime));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.settlementTypeOptions.find(o => o.value === __VLS_ctx.taskForm.settlementType)?.label || '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.createTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.createTime) : '-');
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.formatPlannedDuration(__VLS_ctx.taskForm.targetDuration));
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.startTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.startTime) : '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.endTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.endTime) : '-');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "detail-block-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        (__VLS_ctx.taskForm.createTime ? __VLS_ctx.formatDateTime(__VLS_ctx.taskForm.createTime) : '-');
    }
}
if (__VLS_ctx.taskDialogMode !== 'view') {
    const __VLS_624 = {}.ElForm;
    /** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
    // @ts-ignore
    const __VLS_625 = __VLS_asFunctionalComponent(__VLS_624, new __VLS_624({
        ...{ 'onSubmit': {} },
        ref: "taskFormRef",
        model: (__VLS_ctx.taskForm),
        rules: (__VLS_ctx.taskFormRules),
        labelPosition: "top",
        ...{ class: "task-dialog-form" },
    }));
    const __VLS_626 = __VLS_625({
        ...{ 'onSubmit': {} },
        ref: "taskFormRef",
        model: (__VLS_ctx.taskForm),
        rules: (__VLS_ctx.taskFormRules),
        labelPosition: "top",
        ...{ class: "task-dialog-form" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_625));
    let __VLS_628;
    let __VLS_629;
    let __VLS_630;
    const __VLS_631 = {
        onSubmit: () => { }
    };
    /** @type {typeof __VLS_ctx.taskFormRef} */ ;
    var __VLS_632 = {};
    __VLS_627.slots.default;
    if (__VLS_ctx.isSceneDialog) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-page" },
        });
        const __VLS_634 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_635 = __VLS_asFunctionalComponent(__VLS_634, new __VLS_634({
            label: "场景标题",
            prop: "title",
        }));
        const __VLS_636 = __VLS_635({
            label: "场景标题",
            prop: "title",
        }, ...__VLS_functionalComponentArgsRest(__VLS_635));
        __VLS_637.slots.default;
        const __VLS_638 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_639 = __VLS_asFunctionalComponent(__VLS_638, new __VLS_638({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入场景标题",
            maxlength: "120",
            showWordLimit: true,
        }));
        const __VLS_640 = __VLS_639({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入场景标题",
            maxlength: "120",
            showWordLimit: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_639));
        var __VLS_637;
        const __VLS_642 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_643 = __VLS_asFunctionalComponent(__VLS_642, new __VLS_642({
            label: "场景描述（可选）",
            prop: "description",
        }));
        const __VLS_644 = __VLS_643({
            label: "场景描述（可选）",
            prop: "description",
        }, ...__VLS_functionalComponentArgsRest(__VLS_643));
        __VLS_645.slots.default;
        const __VLS_646 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_647 = __VLS_asFunctionalComponent(__VLS_646, new __VLS_646({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (5),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充场景说明",
        }));
        const __VLS_648 = __VLS_647({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (5),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充场景说明",
        }, ...__VLS_functionalComponentArgsRest(__VLS_647));
        var __VLS_645;
        const __VLS_650 = {}.ElAlert;
        /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
        // @ts-ignore
        const __VLS_651 = __VLS_asFunctionalComponent(__VLS_650, new __VLS_650({
            title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
            type: "info",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }));
        const __VLS_652 = __VLS_651({
            title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
            type: "info",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_651));
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-page" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.taskDialogStep === 0) }, null, null);
        const __VLS_654 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_655 = __VLS_asFunctionalComponent(__VLS_654, new __VLS_654({
            label: "标题",
            prop: "title",
        }));
        const __VLS_656 = __VLS_655({
            label: "标题",
            prop: "title",
        }, ...__VLS_functionalComponentArgsRest(__VLS_655));
        __VLS_657.slots.default;
        const __VLS_658 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_659 = __VLS_asFunctionalComponent(__VLS_658, new __VLS_658({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入任务标题",
            maxlength: "120",
            showWordLimit: true,
        }));
        const __VLS_660 = __VLS_659({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入任务标题",
            maxlength: "120",
            showWordLimit: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_659));
        var __VLS_657;
        const __VLS_662 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_663 = __VLS_asFunctionalComponent(__VLS_662, new __VLS_662({
            label: "描述（可选）",
            prop: "description",
        }));
        const __VLS_664 = __VLS_663({
            label: "描述（可选）",
            prop: "description",
        }, ...__VLS_functionalComponentArgsRest(__VLS_663));
        __VLS_665.slots.default;
        const __VLS_666 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_667 = __VLS_asFunctionalComponent(__VLS_666, new __VLS_666({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (4),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充任务说明",
        }));
        const __VLS_668 = __VLS_667({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (4),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充任务说明",
        }, ...__VLS_functionalComponentArgsRest(__VLS_667));
        var __VLS_665;
        const __VLS_670 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_671 = __VLS_asFunctionalComponent(__VLS_670, new __VLS_670({
            gutter: (14),
        }));
        const __VLS_672 = __VLS_671({
            gutter: (14),
        }, ...__VLS_functionalComponentArgsRest(__VLS_671));
        __VLS_673.slots.default;
        const __VLS_674 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_675 = __VLS_asFunctionalComponent(__VLS_674, new __VLS_674({
            xs: (24),
            sm: (12),
        }));
        const __VLS_676 = __VLS_675({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_675));
        __VLS_677.slots.default;
        const __VLS_678 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_679 = __VLS_asFunctionalComponent(__VLS_678, new __VLS_678({
            label: "类型",
            prop: "type",
        }));
        const __VLS_680 = __VLS_679({
            label: "类型",
            prop: "type",
        }, ...__VLS_functionalComponentArgsRest(__VLS_679));
        __VLS_681.slots.default;
        if (__VLS_ctx.taskForm.type !== 3) {
            const __VLS_682 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_683 = __VLS_asFunctionalComponent(__VLS_682, new __VLS_682({
                modelValue: (__VLS_ctx.taskForm.type),
                ...{ class: "w-full" },
            }));
            const __VLS_684 = __VLS_683({
                modelValue: (__VLS_ctx.taskForm.type),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_683));
            __VLS_685.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.taskTypeOptions))) {
                const __VLS_686 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_687 = __VLS_asFunctionalComponent(__VLS_686, new __VLS_686({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_688 = __VLS_687({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_687));
            }
            var __VLS_685;
        }
        else {
            const __VLS_690 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_691 = __VLS_asFunctionalComponent(__VLS_690, new __VLS_690({
                type: "warning",
            }));
            const __VLS_692 = __VLS_691({
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_691));
            __VLS_693.slots.default;
            var __VLS_693;
        }
        var __VLS_681;
        var __VLS_677;
        var __VLS_673;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-page" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.taskDialogStep === 1) }, null, null);
        if (__VLS_ctx.isRecurringTask) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-title" },
            });
            const __VLS_694 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_695 = __VLS_asFunctionalComponent(__VLS_694, new __VLS_694({
                gutter: (14),
                ...{ class: "task-recurrence-row" },
            }));
            const __VLS_696 = __VLS_695({
                gutter: (14),
                ...{ class: "task-recurrence-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_695));
            __VLS_697.slots.default;
            const __VLS_698 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_699 = __VLS_asFunctionalComponent(__VLS_698, new __VLS_698({
                xs: (24),
                sm: (10),
            }));
            const __VLS_700 = __VLS_699({
                xs: (24),
                sm: (10),
            }, ...__VLS_functionalComponentArgsRest(__VLS_699));
            __VLS_701.slots.default;
            const __VLS_702 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_703 = __VLS_asFunctionalComponent(__VLS_702, new __VLS_702({
                label: "循环尺度",
                prop: "cycleMode",
            }));
            const __VLS_704 = __VLS_703({
                label: "循环尺度",
                prop: "cycleMode",
            }, ...__VLS_functionalComponentArgsRest(__VLS_703));
            __VLS_705.slots.default;
            const __VLS_706 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_707 = __VLS_asFunctionalComponent(__VLS_706, new __VLS_706({
                modelValue: (__VLS_ctx.taskForm.cycleMode),
                ...{ class: "w-full" },
            }));
            const __VLS_708 = __VLS_707({
                modelValue: (__VLS_ctx.taskForm.cycleMode),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_707));
            __VLS_709.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.cycleModeOptions))) {
                const __VLS_710 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_711 = __VLS_asFunctionalComponent(__VLS_710, new __VLS_710({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_712 = __VLS_711({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_711));
            }
            var __VLS_709;
            var __VLS_705;
            var __VLS_701;
            const __VLS_714 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_715 = __VLS_asFunctionalComponent(__VLS_714, new __VLS_714({
                xs: (24),
                sm: (14),
            }));
            const __VLS_716 = __VLS_715({
                xs: (24),
                sm: (14),
            }, ...__VLS_functionalComponentArgsRest(__VLS_715));
            __VLS_717.slots.default;
            if (__VLS_ctx.taskForm.cycleMode === 'interval') {
                const __VLS_718 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_719 = __VLS_asFunctionalComponent(__VLS_718, new __VLS_718({
                    label: "具体选择",
                    prop: "cycleIntervalDays",
                }));
                const __VLS_720 = __VLS_719({
                    label: "具体选择",
                    prop: "cycleIntervalDays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_719));
                __VLS_721.slots.default;
                const __VLS_722 = {}.ElInputNumber;
                /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
                // @ts-ignore
                const __VLS_723 = __VLS_asFunctionalComponent(__VLS_722, new __VLS_722({
                    modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                    min: (1),
                    step: (1),
                    controlsPosition: "right",
                    ...{ class: "w-full" },
                }));
                const __VLS_724 = __VLS_723({
                    modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                    min: (1),
                    step: (1),
                    controlsPosition: "right",
                    ...{ class: "w-full" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_723));
                var __VLS_721;
            }
            else if (__VLS_ctx.taskForm.cycleMode === 'weekly') {
                const __VLS_726 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_727 = __VLS_asFunctionalComponent(__VLS_726, new __VLS_726({
                    label: "具体选择",
                    prop: "cycleWeekdays",
                }));
                const __VLS_728 = __VLS_727({
                    label: "具体选择",
                    prop: "cycleWeekdays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_727));
                __VLS_729.slots.default;
                const __VLS_730 = {}.ElSelect;
                /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
                // @ts-ignore
                const __VLS_731 = __VLS_asFunctionalComponent(__VLS_730, new __VLS_730({
                    modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个星期",
                }));
                const __VLS_732 = __VLS_731({
                    modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个星期",
                }, ...__VLS_functionalComponentArgsRest(__VLS_731));
                __VLS_733.slots.default;
                for (const [option] of __VLS_getVForSourceType((__VLS_ctx.weekdayOptions))) {
                    const __VLS_734 = {}.ElOption;
                    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                    // @ts-ignore
                    const __VLS_735 = __VLS_asFunctionalComponent(__VLS_734, new __VLS_734({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }));
                    const __VLS_736 = __VLS_735({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }, ...__VLS_functionalComponentArgsRest(__VLS_735));
                }
                var __VLS_733;
                var __VLS_729;
            }
            else if (__VLS_ctx.taskForm.cycleMode === 'monthly') {
                const __VLS_738 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_739 = __VLS_asFunctionalComponent(__VLS_738, new __VLS_738({
                    label: "具体选择",
                    prop: "cycleMonthDays",
                }));
                const __VLS_740 = __VLS_739({
                    label: "具体选择",
                    prop: "cycleMonthDays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_739));
                __VLS_741.slots.default;
                const __VLS_742 = {}.ElSelect;
                /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
                // @ts-ignore
                const __VLS_743 = __VLS_asFunctionalComponent(__VLS_742, new __VLS_742({
                    modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个日期",
                }));
                const __VLS_744 = __VLS_743({
                    modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个日期",
                }, ...__VLS_functionalComponentArgsRest(__VLS_743));
                __VLS_745.slots.default;
                for (const [option] of __VLS_getVForSourceType((__VLS_ctx.monthDayOptions))) {
                    const __VLS_746 = {}.ElOption;
                    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                    // @ts-ignore
                    const __VLS_747 = __VLS_asFunctionalComponent(__VLS_746, new __VLS_746({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }));
                    const __VLS_748 = __VLS_747({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }, ...__VLS_functionalComponentArgsRest(__VLS_747));
                }
                var __VLS_745;
                var __VLS_741;
            }
            var __VLS_717;
            var __VLS_697;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-helper-text" },
            });
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-title" },
        });
        const __VLS_750 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_751 = __VLS_asFunctionalComponent(__VLS_750, new __VLS_750({
            gutter: (14),
            ...{ class: "task-duration-row" },
        }));
        const __VLS_752 = __VLS_751({
            gutter: (14),
            ...{ class: "task-duration-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_751));
        __VLS_753.slots.default;
        const __VLS_754 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_755 = __VLS_asFunctionalComponent(__VLS_754, new __VLS_754({
            xs: (24),
            sm: (12),
        }));
        const __VLS_756 = __VLS_755({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_755));
        __VLS_757.slots.default;
        const __VLS_758 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_759 = __VLS_asFunctionalComponent(__VLS_758, new __VLS_758({
            label: "小时",
            prop: "planDurationHours",
        }));
        const __VLS_760 = __VLS_759({
            label: "小时",
            prop: "planDurationHours",
        }, ...__VLS_functionalComponentArgsRest(__VLS_759));
        __VLS_761.slots.default;
        const __VLS_762 = {}.ElInputNumber;
        /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_763 = __VLS_asFunctionalComponent(__VLS_762, new __VLS_762({
            modelValue: (__VLS_ctx.taskForm.planDurationHours),
            min: (0),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }));
        const __VLS_764 = __VLS_763({
            modelValue: (__VLS_ctx.taskForm.planDurationHours),
            min: (0),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_763));
        var __VLS_761;
        var __VLS_757;
        const __VLS_766 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_767 = __VLS_asFunctionalComponent(__VLS_766, new __VLS_766({
            xs: (24),
            sm: (12),
        }));
        const __VLS_768 = __VLS_767({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_767));
        __VLS_769.slots.default;
        const __VLS_770 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_771 = __VLS_asFunctionalComponent(__VLS_770, new __VLS_770({
            label: "分钟",
            prop: "planDurationMinutes",
        }));
        const __VLS_772 = __VLS_771({
            label: "分钟",
            prop: "planDurationMinutes",
        }, ...__VLS_functionalComponentArgsRest(__VLS_771));
        __VLS_773.slots.default;
        const __VLS_774 = {}.ElInputNumber;
        /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_775 = __VLS_asFunctionalComponent(__VLS_774, new __VLS_774({
            modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
            min: (0),
            max: (59),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }));
        const __VLS_776 = __VLS_775({
            modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
            min: (0),
            max: (59),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_775));
        var __VLS_773;
        var __VLS_769;
        var __VLS_753;
        if (__VLS_ctx.isRecurringTask) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-title" },
            });
            const __VLS_778 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_779 = __VLS_asFunctionalComponent(__VLS_778, new __VLS_778({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }));
            const __VLS_780 = __VLS_779({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_779));
            __VLS_781.slots.default;
            const __VLS_782 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_783 = __VLS_asFunctionalComponent(__VLS_782, new __VLS_782({
                xs: (24),
                sm: (12),
            }));
            const __VLS_784 = __VLS_783({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_783));
            __VLS_785.slots.default;
            const __VLS_786 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_787 = __VLS_asFunctionalComponent(__VLS_786, new __VLS_786({
                label: "开始时分",
            }));
            const __VLS_788 = __VLS_787({
                label: "开始时分",
            }, ...__VLS_functionalComponentArgsRest(__VLS_787));
            __VLS_789.slots.default;
            const __VLS_790 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_791 = __VLS_asFunctionalComponent(__VLS_790, new __VLS_790({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_792 = __VLS_791({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_791));
            let __VLS_794;
            let __VLS_795;
            let __VLS_796;
            const __VLS_797 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
            };
            var __VLS_793;
            var __VLS_789;
            var __VLS_785;
            const __VLS_798 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_799 = __VLS_asFunctionalComponent(__VLS_798, new __VLS_798({
                xs: (24),
                sm: (12),
            }));
            const __VLS_800 = __VLS_799({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_799));
            __VLS_801.slots.default;
            const __VLS_802 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_803 = __VLS_asFunctionalComponent(__VLS_802, new __VLS_802({
                label: "结束时分",
            }));
            const __VLS_804 = __VLS_803({
                label: "结束时分",
            }, ...__VLS_functionalComponentArgsRest(__VLS_803));
            __VLS_805.slots.default;
            const __VLS_806 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_807 = __VLS_asFunctionalComponent(__VLS_806, new __VLS_806({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_808 = __VLS_807({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_807));
            let __VLS_810;
            let __VLS_811;
            let __VLS_812;
            const __VLS_813 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
            };
            var __VLS_809;
            var __VLS_805;
            var __VLS_801;
            var __VLS_781;
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-title" },
            });
            const __VLS_814 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_815 = __VLS_asFunctionalComponent(__VLS_814, new __VLS_814({
                label: "开始时间",
                prop: "startTime",
            }));
            const __VLS_816 = __VLS_815({
                label: "开始时间",
                prop: "startTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_815));
            __VLS_817.slots.default;
            const __VLS_818 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_819 = __VLS_asFunctionalComponent(__VLS_818, new __VLS_818({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }));
            const __VLS_820 = __VLS_819({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_819));
            __VLS_821.slots.default;
            const __VLS_822 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_823 = __VLS_asFunctionalComponent(__VLS_822, new __VLS_822({
                xs: (24),
                sm: (12),
            }));
            const __VLS_824 = __VLS_823({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_823));
            __VLS_825.slots.default;
            const __VLS_826 = {}.ElDatePicker;
            /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
            // @ts-ignore
            const __VLS_827 = __VLS_asFunctionalComponent(__VLS_826, new __VLS_826({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }));
            const __VLS_828 = __VLS_827({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_827));
            let __VLS_830;
            let __VLS_831;
            let __VLS_832;
            const __VLS_833 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartDatePart)
            };
            var __VLS_829;
            var __VLS_825;
            const __VLS_834 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_835 = __VLS_asFunctionalComponent(__VLS_834, new __VLS_834({
                xs: (24),
                sm: (12),
            }));
            const __VLS_836 = __VLS_835({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_835));
            __VLS_837.slots.default;
            const __VLS_838 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_839 = __VLS_asFunctionalComponent(__VLS_838, new __VLS_838({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_840 = __VLS_839({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_839));
            let __VLS_842;
            let __VLS_843;
            let __VLS_844;
            const __VLS_845 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
            };
            var __VLS_841;
            var __VLS_837;
            var __VLS_821;
            var __VLS_817;
            const __VLS_846 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_847 = __VLS_asFunctionalComponent(__VLS_846, new __VLS_846({
                label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
                prop: "endTime",
            }));
            const __VLS_848 = __VLS_847({
                label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
                prop: "endTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_847));
            __VLS_849.slots.default;
            const __VLS_850 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_851 = __VLS_asFunctionalComponent(__VLS_850, new __VLS_850({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }));
            const __VLS_852 = __VLS_851({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_851));
            __VLS_853.slots.default;
            const __VLS_854 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_855 = __VLS_asFunctionalComponent(__VLS_854, new __VLS_854({
                xs: (24),
                sm: (12),
            }));
            const __VLS_856 = __VLS_855({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_855));
            __VLS_857.slots.default;
            const __VLS_858 = {}.ElDatePicker;
            /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
            // @ts-ignore
            const __VLS_859 = __VLS_asFunctionalComponent(__VLS_858, new __VLS_858({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }));
            const __VLS_860 = __VLS_859({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_859));
            let __VLS_862;
            let __VLS_863;
            let __VLS_864;
            const __VLS_865 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndDatePart)
            };
            var __VLS_861;
            var __VLS_857;
            const __VLS_866 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_867 = __VLS_asFunctionalComponent(__VLS_866, new __VLS_866({
                xs: (24),
                sm: (12),
            }));
            const __VLS_868 = __VLS_867({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_867));
            __VLS_869.slots.default;
            const __VLS_870 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_871 = __VLS_asFunctionalComponent(__VLS_870, new __VLS_870({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_872 = __VLS_871({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_871));
            let __VLS_874;
            let __VLS_875;
            let __VLS_876;
            const __VLS_877 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
            };
            var __VLS_873;
            var __VLS_869;
            var __VLS_853;
            var __VLS_849;
        }
        if (String(__VLS_ctx.taskForm.type) !== '0') {
            const __VLS_878 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_879 = __VLS_asFunctionalComponent(__VLS_878, new __VLS_878({
                prop: "settlementType",
            }));
            const __VLS_880 = __VLS_879({
                prop: "settlementType",
            }, ...__VLS_functionalComponentArgsRest(__VLS_879));
            __VLS_881.slots.default;
            {
                const { label: __VLS_thisSlot } = __VLS_881.slots;
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-settlement-label" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                const __VLS_882 = {}.ElTooltip;
                /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
                // @ts-ignore
                const __VLS_883 = __VLS_asFunctionalComponent(__VLS_882, new __VLS_882({
                    effect: "dark",
                    placement: "top",
                    rawContent: true,
                    content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
                }));
                const __VLS_884 = __VLS_883({
                    effect: "dark",
                    placement: "top",
                    rawContent: true,
                    content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
                }, ...__VLS_functionalComponentArgsRest(__VLS_883));
                __VLS_885.slots.default;
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-settlement-help" },
                    'aria-label': "结算模式说明",
                });
                var __VLS_885;
            }
            const __VLS_886 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_887 = __VLS_asFunctionalComponent(__VLS_886, new __VLS_886({
                modelValue: (__VLS_ctx.taskForm.settlementType),
                ...{ class: "w-full" },
            }));
            const __VLS_888 = __VLS_887({
                modelValue: (__VLS_ctx.taskForm.settlementType),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_887));
            __VLS_889.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.settlementTypeOptions))) {
                const __VLS_890 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_891 = __VLS_asFunctionalComponent(__VLS_890, new __VLS_890({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_892 = __VLS_891({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_891));
            }
            var __VLS_889;
            var __VLS_881;
        }
        if (__VLS_ctx.taskDialogParent) {
            const __VLS_894 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_895 = __VLS_asFunctionalComponent(__VLS_894, new __VLS_894({
                label: "是否同步时长到父任务",
                prop: "inheritParentTime",
            }));
            const __VLS_896 = __VLS_895({
                label: "是否同步时长到父任务",
                prop: "inheritParentTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_895));
            __VLS_897.slots.default;
            const __VLS_898 = {}.ElSwitch;
            /** @type {[typeof __VLS_components.ElSwitch, typeof __VLS_components.elSwitch, ]} */ ;
            // @ts-ignore
            const __VLS_899 = __VLS_asFunctionalComponent(__VLS_898, new __VLS_898({
                modelValue: (__VLS_ctx.taskForm.inheritParentTime),
                activeText: "同步",
                inactiveText: "不计入",
            }));
            const __VLS_900 = __VLS_899({
                modelValue: (__VLS_ctx.taskForm.inheritParentTime),
                activeText: "同步",
                inactiveText: "不计入",
            }, ...__VLS_functionalComponentArgsRest(__VLS_899));
            var __VLS_897;
        }
    }
    var __VLS_627;
}
{
    const { footer: __VLS_thisSlot } = __VLS_579.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-footer" },
    });
    const __VLS_902 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_903 = __VLS_asFunctionalComponent(__VLS_902, new __VLS_902({
        ...{ 'onClick': {} },
    }));
    const __VLS_904 = __VLS_903({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_903));
    let __VLS_906;
    let __VLS_907;
    let __VLS_908;
    const __VLS_909 = {
        onClick: (...[$event]) => {
            __VLS_ctx.taskDialogVisible = false;
        }
    };
    __VLS_905.slots.default;
    var __VLS_905;
    if (__VLS_ctx.taskDialogMode === 'view') {
    }
    else {
        if (__VLS_ctx.isSceneDialog) {
            const __VLS_910 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_911 = __VLS_asFunctionalComponent(__VLS_910, new __VLS_910({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }));
            const __VLS_912 = __VLS_911({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }, ...__VLS_functionalComponentArgsRest(__VLS_911));
            let __VLS_914;
            let __VLS_915;
            let __VLS_916;
            const __VLS_917 = {
                onClick: (__VLS_ctx.submitTaskDialog)
            };
            __VLS_913.slots.default;
            var __VLS_913;
        }
        else {
            if (__VLS_ctx.taskDialogStep > 0) {
                const __VLS_918 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_919 = __VLS_asFunctionalComponent(__VLS_918, new __VLS_918({
                    ...{ 'onClick': {} },
                }));
                const __VLS_920 = __VLS_919({
                    ...{ 'onClick': {} },
                }, ...__VLS_functionalComponentArgsRest(__VLS_919));
                let __VLS_922;
                let __VLS_923;
                let __VLS_924;
                const __VLS_925 = {
                    onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.taskDialogMode === 'view'))
                            return;
                        if (!!(__VLS_ctx.isSceneDialog))
                            return;
                        if (!(__VLS_ctx.taskDialogStep > 0))
                            return;
                        __VLS_ctx.taskDialogStep -= 1;
                    }
                };
                __VLS_921.slots.default;
                var __VLS_921;
            }
            if (__VLS_ctx.taskDialogStep === 0) {
                const __VLS_926 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_927 = __VLS_asFunctionalComponent(__VLS_926, new __VLS_926({
                    ...{ 'onClick': {} },
                    type: "warning",
                }));
                const __VLS_928 = __VLS_927({
                    ...{ 'onClick': {} },
                    type: "warning",
                }, ...__VLS_functionalComponentArgsRest(__VLS_927));
                let __VLS_930;
                let __VLS_931;
                let __VLS_932;
                const __VLS_933 = {
                    onClick: (__VLS_ctx.goTaskDialogNext)
                };
                __VLS_929.slots.default;
                var __VLS_929;
            }
            else {
                const __VLS_934 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_935 = __VLS_asFunctionalComponent(__VLS_934, new __VLS_934({
                    ...{ 'onClick': {} },
                    type: "warning",
                    loading: (__VLS_ctx.taskDialogLoading),
                }));
                const __VLS_936 = __VLS_935({
                    ...{ 'onClick': {} },
                    type: "warning",
                    loading: (__VLS_ctx.taskDialogLoading),
                }, ...__VLS_functionalComponentArgsRest(__VLS_935));
                let __VLS_938;
                let __VLS_939;
                let __VLS_940;
                const __VLS_941 = {
                    onClick: (__VLS_ctx.submitTaskDialog)
                };
                __VLS_937.slots.default;
                var __VLS_937;
            }
        }
    }
}
var __VLS_579;
/** @type {__VLS_StyleScopedClasses['home-shell']} */ ;
/** @type {__VLS_StyleScopedClasses['sidebar']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-title']} */ ;
/** @type {__VLS_StyleScopedClasses['user-card']} */ ;
/** @type {__VLS_StyleScopedClasses['user-card-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['user-card-content']} */ ;
/** @type {__VLS_StyleScopedClasses['user-card-name']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-list']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
/** @type {__VLS_StyleScopedClasses['sidebar-bottom']} */ ;
/** @type {__VLS_StyleScopedClasses['logout-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['content-area']} */ ;
/** @type {__VLS_StyleScopedClasses['content-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['section-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['section-toolbar-left']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['clock-progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['section-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['section-toolbar-left']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-layout']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions-left']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['clock-progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions-left']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['clock-progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-layout']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions-left']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-title']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['clock-progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['task-split-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-stacked']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions-left']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-title']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-main']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['clock-progress-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['review-layout']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['review-editor-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['review-tips']} */ ;
/** @type {__VLS_StyleScopedClasses['review-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['review-history-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['review-list']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-top']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-snippet']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['review-detail-card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-pre']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-pre']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-steps']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-parent-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-recurring']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-ddl']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['task-type-icon-note']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-alert']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['read-only-view']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-text']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-block-label']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-alert']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-page']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-block']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-recurrence-row']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-helper-text']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-block']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-duration-row']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-block']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-datetime-row']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-block']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-section-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-datetime-row']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-datetime-row']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-settlement-label']} */ ;
/** @type {__VLS_StyleScopedClasses['task-settlement-help']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-footer']} */ ;
// @ts-ignore
var __VLS_633 = __VLS_632;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Calendar: Calendar,
            Clock: Clock,
            Document: Document,
            VideoPause: VideoPause,
            VideoPlay: VideoPlay,
            activeSection: activeSection,
            loadingTasks: loadingTasks,
            savingReview: savingReview,
            taskDialogVisible: taskDialogVisible,
            taskDialogStep: taskDialogStep,
            taskDialogMode: taskDialogMode,
            taskDialogLoading: taskDialogLoading,
            taskDialogParent: taskDialogParent,
            taskFormRef: taskFormRef,
            reviewHistory: reviewHistory,
            reviewDraft: reviewDraft,
            taskTypeOptions: taskTypeOptions,
            cycleModeOptions: cycleModeOptions,
            weekdayOptions: weekdayOptions,
            monthDayOptions: monthDayOptions,
            settlementTypeOptions: settlementTypeOptions,
            isHeartbeatTask: isHeartbeatTask,
            progressPercent: progressPercent,
            clockLabel: clockLabel,
            taskForm: taskForm,
            displayUsername: displayUsername,
            isRecurringTask: isRecurringTask,
            taskDialogTitle: taskDialogTitle,
            taskDialogWarnings: taskDialogWarnings,
            taskFormRules: taskFormRules,
            treeProps: treeProps,
            todayLabel: todayLabel,
            sectionItems: sectionItems,
            setActiveSection: setActiveSection,
            activeSectionTitle: activeSectionTitle,
            isSceneDialog: isSceneDialog,
            sceneTaskTree: sceneTaskTree,
            nonSceneTaskTree: nonSceneTaskTree,
            currentTodayTree: currentTodayTree,
            currentTodoTodayTree: currentTodoTodayTree,
            currentTodoFutureTree: currentTodoFutureTree,
            selectedReview: selectedReview,
            resetTaskDialog: resetTaskDialog,
            openCreateTaskDialog: openCreateTaskDialog,
            openCreateSceneDialog: openCreateSceneDialog,
            openEditTaskDialog: openEditTaskDialog,
            openViewTaskDialog: openViewTaskDialog,
            goTaskDialogNext: goTaskDialogNext,
            submitTaskDialog: submitTaskDialog,
            deleteTask: deleteTask,
            loadTasks: loadTasks,
            loadReviews: loadReviews,
            saveDraft: saveDraft,
            saveReviewToServer: saveReviewToServer,
            selectReview: selectReview,
            handleLogout: handleLogout,
            toggleActive: toggleActive,
            toggleComplete: toggleComplete,
            toggleRunStatus: toggleRunStatus,
            getDatePart: getDatePart,
            getTimePart: getTimePart,
            updateStartDatePart: updateStartDatePart,
            updateStartTimePart: updateStartTimePart,
            updateEndDatePart: updateEndDatePart,
            updateEndTimePart: updateEndTimePart,
            reviewSnippet: reviewSnippet,
            prettyJson: prettyJson,
            formatDuration: formatDuration,
            formatDateOnly: formatDateOnly,
            formatDateTime: formatDateTime,
            formatTimeOnly: formatTimeOnly,
            formatTaskMetaSummary: formatTaskMetaSummary,
            formatPlannedDuration: formatPlannedDuration,
            formatRecurrence: formatRecurrence,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
