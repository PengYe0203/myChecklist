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
const getRunStatusKey = (task) => String(task.runStatus ?? 0);
const isHeartbeatTask = (task) => getRunStatusKey(task) === '1' && !task.isCompleted;
const nextRunStatus = (task) => (isHeartbeatTask(task) ? 'PAUSED' : 'IN_PROGRESS');
const runStatusLabel = (task) => {
    const status = getRunStatusKey(task);
    if (status === '1')
        return '暂停';
    if (status === '2')
        return '继续';
    return '开始';
};
const runStatusIcon = (task) => (isHeartbeatTask(task) ? VideoPause : VideoPlay);
const heartbeatPercent = (task) => {
    const start = parseHeartbeatTime(task.lastStartTime);
    if (!start)
        return 0;
    const elapsed = Math.max(0, heartbeatNow.value - start.getTime());
    return Math.min(100, Math.round((elapsed / HEARTBEAT_INTERVAL_MS) * 100));
};
const heartbeatRemainingSeconds = (task) => {
    const start = parseHeartbeatTime(task.lastStartTime);
    if (!start)
        return Math.ceil(HEARTBEAT_INTERVAL_MS / 1000);
    const remaining = HEARTBEAT_INTERVAL_MS - Math.max(0, heartbeatNow.value - start.getTime());
    return Math.max(0, Math.ceil(remaining / 1000));
};
const heartbeatTooltip = (task) => {
    if (!isHeartbeatTask(task))
        return '未运行';
    return `心跳倒计时 ${heartbeatRemainingSeconds(task)}s`;
};
const runStatusTooltip = (task) => `点击${runStatusLabel(task)}`;
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
        void Promise.all(dueTasks.map(async (task) => {
            try {
                await heartbeatApi(task.taskId);
                task.lastStartTime = new Date(heartbeatNow.value).toISOString();
            }
            catch {
                // 后端/网络异常由全局拦截器或控制台处理，这里不打断页面
            }
        })).finally(() => {
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
    await toggleActiveApi(task.taskId, !Boolean(task.active));
    ElMessage.success('任务状态已更新');
    await loadTasks();
};
const toggleComplete = async (task) => {
    await toggleCompleteApi(task.taskId, !Boolean(task.isCompleted));
    ElMessage.success('完成状态已更新');
    await loadTasks();
};
const toggleRunStatus = async (task) => {
    const targetStatus = nextRunStatus(task);
    await toggleRunStatusApi(task.taskId, targetStatus);
    ElMessage.success('运行状态已更新');
    await loadTasks();
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
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
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            const __VLS_60 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_61 = __VLS_asFunctionalComponent(__VLS_60, new __VLS_60({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }));
            const __VLS_62 = __VLS_61({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_61));
            __VLS_63.slots.default;
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
            const __VLS_64 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({}));
            const __VLS_66 = __VLS_65({}, ...__VLS_functionalComponentArgsRest(__VLS_65));
            __VLS_67.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_68 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_69 = __VLS_asFunctionalComponent(__VLS_68, new __VLS_68({}));
                const __VLS_70 = __VLS_69({}, ...__VLS_functionalComponentArgsRest(__VLS_69));
            }
            else {
                const __VLS_72 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({}));
                const __VLS_74 = __VLS_73({}, ...__VLS_functionalComponentArgsRest(__VLS_73));
            }
            var __VLS_67;
            var __VLS_63;
            const __VLS_76 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_77 = __VLS_asFunctionalComponent(__VLS_76, new __VLS_76({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }));
            const __VLS_78 = __VLS_77({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_77));
            __VLS_79.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_80 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_82 = __VLS_81({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_81));
            var __VLS_79;
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta task-node-meta-inline" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_84 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_85 = __VLS_asFunctionalComponent(__VLS_84, new __VLS_84({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_86 = __VLS_85({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
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
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_87.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_87;
            const __VLS_92 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_93 = __VLS_asFunctionalComponent(__VLS_92, new __VLS_92({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_94 = __VLS_93({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
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
                    __VLS_ctx.openEditTaskDialog(data);
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
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_102 = __VLS_101({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
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
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_103.slots.default;
            var __VLS_103;
            const __VLS_108 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_109 = __VLS_asFunctionalComponent(__VLS_108, new __VLS_108({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_110 = __VLS_109({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
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
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_111.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_111;
            const __VLS_116 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_117 = __VLS_asFunctionalComponent(__VLS_116, new __VLS_116({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_118 = __VLS_117({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_117));
            let __VLS_120;
            let __VLS_121;
            let __VLS_122;
            const __VLS_123 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_119.slots.default;
            var __VLS_119;
        }
        var __VLS_31;
    }
}
if (__VLS_ctx.activeSection === 'todo') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-toolbar section-toolbar-left" },
    });
    const __VLS_124 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_125 = __VLS_asFunctionalComponent(__VLS_124, new __VLS_124({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_126 = __VLS_125({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_125));
    let __VLS_128;
    let __VLS_129;
    let __VLS_130;
    const __VLS_131 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.activeSection === 'todo'))
                return;
            __VLS_ctx.openCreateTaskDialog();
        }
    };
    __VLS_127.slots.default;
    var __VLS_127;
    const __VLS_132 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_133 = __VLS_asFunctionalComponent(__VLS_132, new __VLS_132({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_134 = __VLS_133({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_133));
    let __VLS_136;
    let __VLS_137;
    let __VLS_138;
    const __VLS_139 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_135.slots.default;
    var __VLS_135;
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
        const __VLS_140 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_141 = __VLS_asFunctionalComponent(__VLS_140, new __VLS_140({
            description: "当前没有今日待办",
        }));
        const __VLS_142 = __VLS_141({
            description: "当前没有今日待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_141));
    }
    else {
        const __VLS_144 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_146 = __VLS_145({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_145));
        __VLS_147.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_147.slots;
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
                const __VLS_148 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_149 = __VLS_asFunctionalComponent(__VLS_148, new __VLS_148({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_150 = __VLS_149({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_149));
                __VLS_151.slots.default;
                const __VLS_152 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_153 = __VLS_asFunctionalComponent(__VLS_152, new __VLS_152({}));
                const __VLS_154 = __VLS_153({}, ...__VLS_functionalComponentArgsRest(__VLS_153));
                var __VLS_151;
            }
            else if (String(data.type) === '2') {
                const __VLS_156 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_157 = __VLS_asFunctionalComponent(__VLS_156, new __VLS_156({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_158 = __VLS_157({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_157));
                __VLS_159.slots.default;
                const __VLS_160 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_161 = __VLS_asFunctionalComponent(__VLS_160, new __VLS_160({}));
                const __VLS_162 = __VLS_161({}, ...__VLS_functionalComponentArgsRest(__VLS_161));
                var __VLS_159;
            }
            else {
                const __VLS_164 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_165 = __VLS_asFunctionalComponent(__VLS_164, new __VLS_164({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_166 = __VLS_165({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_165));
                __VLS_167.slots.default;
                const __VLS_168 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({}));
                const __VLS_170 = __VLS_169({}, ...__VLS_functionalComponentArgsRest(__VLS_169));
                var __VLS_167;
            }
            const __VLS_172 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_173 = __VLS_asFunctionalComponent(__VLS_172, new __VLS_172({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_174 = __VLS_173({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_173));
            __VLS_175.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_175;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            const __VLS_176 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_177 = __VLS_asFunctionalComponent(__VLS_176, new __VLS_176({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }));
            const __VLS_178 = __VLS_177({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_177));
            __VLS_179.slots.default;
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
            const __VLS_180 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_181 = __VLS_asFunctionalComponent(__VLS_180, new __VLS_180({}));
            const __VLS_182 = __VLS_181({}, ...__VLS_functionalComponentArgsRest(__VLS_181));
            __VLS_183.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_184 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_185 = __VLS_asFunctionalComponent(__VLS_184, new __VLS_184({}));
                const __VLS_186 = __VLS_185({}, ...__VLS_functionalComponentArgsRest(__VLS_185));
            }
            else {
                const __VLS_188 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_189 = __VLS_asFunctionalComponent(__VLS_188, new __VLS_188({}));
                const __VLS_190 = __VLS_189({}, ...__VLS_functionalComponentArgsRest(__VLS_189));
            }
            var __VLS_183;
            var __VLS_179;
            const __VLS_192 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }));
            const __VLS_194 = __VLS_193({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_193));
            __VLS_195.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_196 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_197 = __VLS_asFunctionalComponent(__VLS_196, new __VLS_196({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_198 = __VLS_197({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_197));
            var __VLS_195;
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta task-node-meta-inline" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_200 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_202 = __VLS_201({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
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
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_203.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_203;
            const __VLS_208 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_209 = __VLS_asFunctionalComponent(__VLS_208, new __VLS_208({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_210 = __VLS_209({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
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
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_211.slots.default;
            var __VLS_211;
            const __VLS_216 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_218 = __VLS_217({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
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
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_219.slots.default;
            var __VLS_219;
            const __VLS_224 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_225 = __VLS_asFunctionalComponent(__VLS_224, new __VLS_224({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_226 = __VLS_225({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_225));
            let __VLS_228;
            let __VLS_229;
            let __VLS_230;
            const __VLS_231 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_227.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_227;
            const __VLS_232 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_233 = __VLS_asFunctionalComponent(__VLS_232, new __VLS_232({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_234 = __VLS_233({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_233));
            let __VLS_236;
            let __VLS_237;
            let __VLS_238;
            const __VLS_239 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_235.slots.default;
            var __VLS_235;
        }
        var __VLS_147;
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
        const __VLS_240 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
            description: "当前没有后续待办",
        }));
        const __VLS_242 = __VLS_241({
            description: "当前没有后续待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_241));
    }
    else {
        const __VLS_244 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_245 = __VLS_asFunctionalComponent(__VLS_244, new __VLS_244({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_246 = __VLS_245({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_245));
        __VLS_247.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_247.slots;
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
                const __VLS_248 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_249 = __VLS_asFunctionalComponent(__VLS_248, new __VLS_248({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_250 = __VLS_249({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_249));
                __VLS_251.slots.default;
                const __VLS_252 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_253 = __VLS_asFunctionalComponent(__VLS_252, new __VLS_252({}));
                const __VLS_254 = __VLS_253({}, ...__VLS_functionalComponentArgsRest(__VLS_253));
                var __VLS_251;
            }
            else if (String(data.type) === '2') {
                const __VLS_256 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_257 = __VLS_asFunctionalComponent(__VLS_256, new __VLS_256({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_258 = __VLS_257({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_257));
                __VLS_259.slots.default;
                const __VLS_260 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_261 = __VLS_asFunctionalComponent(__VLS_260, new __VLS_260({}));
                const __VLS_262 = __VLS_261({}, ...__VLS_functionalComponentArgsRest(__VLS_261));
                var __VLS_259;
            }
            else {
                const __VLS_264 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_265 = __VLS_asFunctionalComponent(__VLS_264, new __VLS_264({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_266 = __VLS_265({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_265));
                __VLS_267.slots.default;
                const __VLS_268 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_269 = __VLS_asFunctionalComponent(__VLS_268, new __VLS_268({}));
                const __VLS_270 = __VLS_269({}, ...__VLS_functionalComponentArgsRest(__VLS_269));
                var __VLS_267;
            }
            const __VLS_272 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_273 = __VLS_asFunctionalComponent(__VLS_272, new __VLS_272({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_274 = __VLS_273({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_273));
            __VLS_275.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_275;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            const __VLS_276 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_277 = __VLS_asFunctionalComponent(__VLS_276, new __VLS_276({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }));
            const __VLS_278 = __VLS_277({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_277));
            __VLS_279.slots.default;
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
            const __VLS_280 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_281 = __VLS_asFunctionalComponent(__VLS_280, new __VLS_280({}));
            const __VLS_282 = __VLS_281({}, ...__VLS_functionalComponentArgsRest(__VLS_281));
            __VLS_283.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_284 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_285 = __VLS_asFunctionalComponent(__VLS_284, new __VLS_284({}));
                const __VLS_286 = __VLS_285({}, ...__VLS_functionalComponentArgsRest(__VLS_285));
            }
            else {
                const __VLS_288 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_289 = __VLS_asFunctionalComponent(__VLS_288, new __VLS_288({}));
                const __VLS_290 = __VLS_289({}, ...__VLS_functionalComponentArgsRest(__VLS_289));
            }
            var __VLS_283;
            var __VLS_279;
            const __VLS_292 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_293 = __VLS_asFunctionalComponent(__VLS_292, new __VLS_292({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }));
            const __VLS_294 = __VLS_293({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_293));
            __VLS_295.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_296 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_297 = __VLS_asFunctionalComponent(__VLS_296, new __VLS_296({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_298 = __VLS_297({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_297));
            var __VLS_295;
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_300 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_301 = __VLS_asFunctionalComponent(__VLS_300, new __VLS_300({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_302 = __VLS_301({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
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
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_303.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_303;
            const __VLS_308 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_309 = __VLS_asFunctionalComponent(__VLS_308, new __VLS_308({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_310 = __VLS_309({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
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
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_311.slots.default;
            var __VLS_311;
            const __VLS_316 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_317 = __VLS_asFunctionalComponent(__VLS_316, new __VLS_316({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_318 = __VLS_317({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_317));
            let __VLS_320;
            let __VLS_321;
            let __VLS_322;
            const __VLS_323 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_319.slots.default;
            var __VLS_319;
            const __VLS_324 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_325 = __VLS_asFunctionalComponent(__VLS_324, new __VLS_324({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_326 = __VLS_325({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_325));
            let __VLS_328;
            let __VLS_329;
            let __VLS_330;
            const __VLS_331 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_327.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_327;
            const __VLS_332 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_333 = __VLS_asFunctionalComponent(__VLS_332, new __VLS_332({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_334 = __VLS_333({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_333));
            let __VLS_336;
            let __VLS_337;
            let __VLS_338;
            const __VLS_339 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_335.slots.default;
            var __VLS_335;
        }
        var __VLS_247;
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
    const __VLS_340 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_341 = __VLS_asFunctionalComponent(__VLS_340, new __VLS_340({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_342 = __VLS_341({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_341));
    let __VLS_344;
    let __VLS_345;
    let __VLS_346;
    const __VLS_347 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateSceneDialog();
        }
    };
    __VLS_343.slots.default;
    var __VLS_343;
    const __VLS_348 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_349 = __VLS_asFunctionalComponent(__VLS_348, new __VLS_348({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_350 = __VLS_349({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_349));
    let __VLS_352;
    let __VLS_353;
    let __VLS_354;
    const __VLS_355 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_351.slots.default;
    var __VLS_351;
    if (!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_356 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_357 = __VLS_asFunctionalComponent(__VLS_356, new __VLS_356({
            description: "当前没有场景",
        }));
        const __VLS_358 = __VLS_357({
            description: "当前没有场景",
        }, ...__VLS_functionalComponentArgsRest(__VLS_357));
    }
    else {
        const __VLS_360 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_361 = __VLS_asFunctionalComponent(__VLS_360, new __VLS_360({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_362 = __VLS_361({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_361));
        __VLS_363.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_363.slots;
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
                const __VLS_364 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_365 = __VLS_asFunctionalComponent(__VLS_364, new __VLS_364({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_366 = __VLS_365({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_365));
                __VLS_367.slots.default;
                const __VLS_368 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_369 = __VLS_asFunctionalComponent(__VLS_368, new __VLS_368({}));
                const __VLS_370 = __VLS_369({}, ...__VLS_functionalComponentArgsRest(__VLS_369));
                var __VLS_367;
            }
            else if (String(data.type) === '2') {
                const __VLS_372 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_373 = __VLS_asFunctionalComponent(__VLS_372, new __VLS_372({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_374 = __VLS_373({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_373));
                __VLS_375.slots.default;
                const __VLS_376 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_377 = __VLS_asFunctionalComponent(__VLS_376, new __VLS_376({}));
                const __VLS_378 = __VLS_377({}, ...__VLS_functionalComponentArgsRest(__VLS_377));
                var __VLS_375;
            }
            else {
                const __VLS_380 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_381 = __VLS_asFunctionalComponent(__VLS_380, new __VLS_380({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_382 = __VLS_381({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_381));
                __VLS_383.slots.default;
                const __VLS_384 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_385 = __VLS_asFunctionalComponent(__VLS_384, new __VLS_384({}));
                const __VLS_386 = __VLS_385({}, ...__VLS_functionalComponentArgsRest(__VLS_385));
                var __VLS_383;
            }
            const __VLS_388 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_389 = __VLS_asFunctionalComponent(__VLS_388, new __VLS_388({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_390 = __VLS_389({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_389));
            __VLS_391.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_391;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_392 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_393 = __VLS_asFunctionalComponent(__VLS_392, new __VLS_392({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_394 = __VLS_393({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
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
                    __VLS_ctx.openCreateTaskDialog(data, false);
                }
            };
            __VLS_395.slots.default;
            var __VLS_395;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            const __VLS_400 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_401 = __VLS_asFunctionalComponent(__VLS_400, new __VLS_400({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }));
            const __VLS_402 = __VLS_401({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_401));
            __VLS_403.slots.default;
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
            const __VLS_404 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_405 = __VLS_asFunctionalComponent(__VLS_404, new __VLS_404({}));
            const __VLS_406 = __VLS_405({}, ...__VLS_functionalComponentArgsRest(__VLS_405));
            __VLS_407.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_408 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_409 = __VLS_asFunctionalComponent(__VLS_408, new __VLS_408({}));
                const __VLS_410 = __VLS_409({}, ...__VLS_functionalComponentArgsRest(__VLS_409));
            }
            else {
                const __VLS_412 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_413 = __VLS_asFunctionalComponent(__VLS_412, new __VLS_412({}));
                const __VLS_414 = __VLS_413({}, ...__VLS_functionalComponentArgsRest(__VLS_413));
            }
            var __VLS_407;
            var __VLS_403;
            const __VLS_416 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_417 = __VLS_asFunctionalComponent(__VLS_416, new __VLS_416({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }));
            const __VLS_418 = __VLS_417({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_417));
            __VLS_419.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_420 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_421 = __VLS_asFunctionalComponent(__VLS_420, new __VLS_420({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_422 = __VLS_421({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_421));
            var __VLS_419;
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta task-node-meta-inline" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_424 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_425 = __VLS_asFunctionalComponent(__VLS_424, new __VLS_424({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_426 = __VLS_425({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
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
                    if (!!(!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_427.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_427;
            const __VLS_432 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_433 = __VLS_asFunctionalComponent(__VLS_432, new __VLS_432({
                ...{ 'onClick': {} },
                size: "small",
                type: (data.active ? 'warning' : 'primary'),
            }));
            const __VLS_434 = __VLS_433({
                ...{ 'onClick': {} },
                size: "small",
                type: (data.active ? 'warning' : 'primary'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_433));
            let __VLS_436;
            let __VLS_437;
            let __VLS_438;
            const __VLS_439 = {
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
            __VLS_435.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_435;
            const __VLS_440 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_441 = __VLS_asFunctionalComponent(__VLS_440, new __VLS_440({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_442 = __VLS_441({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_441));
            let __VLS_444;
            let __VLS_445;
            let __VLS_446;
            const __VLS_447 = {
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
            __VLS_443.slots.default;
            var __VLS_443;
            const __VLS_448 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_449 = __VLS_asFunctionalComponent(__VLS_448, new __VLS_448({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_450 = __VLS_449({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_449));
            let __VLS_452;
            let __VLS_453;
            let __VLS_454;
            const __VLS_455 = {
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
            __VLS_451.slots.default;
            var __VLS_451;
        }
        var __VLS_363;
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
    const __VLS_456 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_457 = __VLS_asFunctionalComponent(__VLS_456, new __VLS_456({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_458 = __VLS_457({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_457));
    let __VLS_460;
    let __VLS_461;
    let __VLS_462;
    const __VLS_463 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateTaskDialog(null, false);
        }
    };
    __VLS_459.slots.default;
    var __VLS_459;
    const __VLS_464 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_465 = __VLS_asFunctionalComponent(__VLS_464, new __VLS_464({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_466 = __VLS_465({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_465));
    let __VLS_468;
    let __VLS_469;
    let __VLS_470;
    const __VLS_471 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_467.slots.default;
    var __VLS_467;
    if (!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_472 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_473 = __VLS_asFunctionalComponent(__VLS_472, new __VLS_472({
            description: "当前没有非场景任务",
        }));
        const __VLS_474 = __VLS_473({
            description: "当前没有非场景任务",
        }, ...__VLS_functionalComponentArgsRest(__VLS_473));
    }
    else {
        const __VLS_476 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_477 = __VLS_asFunctionalComponent(__VLS_476, new __VLS_476({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }));
        const __VLS_478 = __VLS_477({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_477));
        __VLS_479.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_479.slots;
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
                const __VLS_480 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_481 = __VLS_asFunctionalComponent(__VLS_480, new __VLS_480({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }));
                const __VLS_482 = __VLS_481({
                    ...{ class: "task-type-icon task-type-icon-recurring" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_481));
                __VLS_483.slots.default;
                const __VLS_484 = {}.Clock;
                /** @type {[typeof __VLS_components.Clock, ]} */ ;
                // @ts-ignore
                const __VLS_485 = __VLS_asFunctionalComponent(__VLS_484, new __VLS_484({}));
                const __VLS_486 = __VLS_485({}, ...__VLS_functionalComponentArgsRest(__VLS_485));
                var __VLS_483;
            }
            else if (String(data.type) === '2') {
                const __VLS_488 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_489 = __VLS_asFunctionalComponent(__VLS_488, new __VLS_488({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }));
                const __VLS_490 = __VLS_489({
                    ...{ class: "task-type-icon task-type-icon-ddl" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_489));
                __VLS_491.slots.default;
                const __VLS_492 = {}.Calendar;
                /** @type {[typeof __VLS_components.Calendar, ]} */ ;
                // @ts-ignore
                const __VLS_493 = __VLS_asFunctionalComponent(__VLS_492, new __VLS_492({}));
                const __VLS_494 = __VLS_493({}, ...__VLS_functionalComponentArgsRest(__VLS_493));
                var __VLS_491;
            }
            else {
                const __VLS_496 = {}.ElIcon;
                /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
                // @ts-ignore
                const __VLS_497 = __VLS_asFunctionalComponent(__VLS_496, new __VLS_496({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }));
                const __VLS_498 = __VLS_497({
                    ...{ class: "task-type-icon task-type-icon-note" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_497));
                __VLS_499.slots.default;
                const __VLS_500 = {}.Document;
                /** @type {[typeof __VLS_components.Document, ]} */ ;
                // @ts-ignore
                const __VLS_501 = __VLS_asFunctionalComponent(__VLS_500, new __VLS_500({}));
                const __VLS_502 = __VLS_501({}, ...__VLS_functionalComponentArgsRest(__VLS_501));
                var __VLS_499;
            }
            const __VLS_504 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_505 = __VLS_asFunctionalComponent(__VLS_504, new __VLS_504({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }));
            const __VLS_506 = __VLS_505({
                placement: "top",
                content: (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            }, ...__VLS_functionalComponentArgsRest(__VLS_505));
            __VLS_507.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
                ...{ class: (['active-dot', { 'dot-completed': data.isCompleted, 'dot-inactive': !data.active && !data.isCompleted, 'dot-pending': !data.isCompleted && data.active }]) },
                role: "img",
                'aria-label': (data.isCompleted ? '已完成' : (!data.active ? '未激活' : '未完成')),
            });
            var __VLS_507;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock" },
                ...{ class: ({ 'is-running': __VLS_ctx.isHeartbeatTask(data) }) },
            });
            const __VLS_508 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_509 = __VLS_asFunctionalComponent(__VLS_508, new __VLS_508({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }));
            const __VLS_510 = __VLS_509({
                content: (__VLS_ctx.runStatusTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_509));
            __VLS_511.slots.default;
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
            const __VLS_512 = {}.ElIcon;
            /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
            // @ts-ignore
            const __VLS_513 = __VLS_asFunctionalComponent(__VLS_512, new __VLS_512({}));
            const __VLS_514 = __VLS_513({}, ...__VLS_functionalComponentArgsRest(__VLS_513));
            __VLS_515.slots.default;
            if (__VLS_ctx.isHeartbeatTask(data)) {
                const __VLS_516 = {}.VideoPause;
                /** @type {[typeof __VLS_components.VideoPause, ]} */ ;
                // @ts-ignore
                const __VLS_517 = __VLS_asFunctionalComponent(__VLS_516, new __VLS_516({}));
                const __VLS_518 = __VLS_517({}, ...__VLS_functionalComponentArgsRest(__VLS_517));
            }
            else {
                const __VLS_520 = {}.VideoPlay;
                /** @type {[typeof __VLS_components.VideoPlay, ]} */ ;
                // @ts-ignore
                const __VLS_521 = __VLS_asFunctionalComponent(__VLS_520, new __VLS_520({}));
                const __VLS_522 = __VLS_521({}, ...__VLS_functionalComponentArgsRest(__VLS_521));
            }
            var __VLS_515;
            var __VLS_511;
            const __VLS_524 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_525 = __VLS_asFunctionalComponent(__VLS_524, new __VLS_524({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }));
            const __VLS_526 = __VLS_525({
                content: (__VLS_ctx.heartbeatTooltip(data)),
                placement: "top",
            }, ...__VLS_functionalComponentArgsRest(__VLS_525));
            __VLS_527.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-clock-bar" },
            });
            const __VLS_528 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_529 = __VLS_asFunctionalComponent(__VLS_528, new __VLS_528({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }));
            const __VLS_530 = __VLS_529({
                percentage: (__VLS_ctx.heartbeatPercent(data)),
                showText: (false),
                strokeWidth: (4),
                color: ('#93c5fd'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_529));
            var __VLS_527;
            if (__VLS_ctx.formatTaskMetaSummary(data)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "task-node-meta task-node-meta-inline" },
                });
                (__VLS_ctx.formatTaskMetaSummary(data));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_532 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_533 = __VLS_asFunctionalComponent(__VLS_532, new __VLS_532({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }));
            const __VLS_534 = __VLS_533({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
                ...{ class: (data.isCompleted ? 'btn-revoke' : '') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_533));
            let __VLS_536;
            let __VLS_537;
            let __VLS_538;
            const __VLS_539 = {
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
            __VLS_535.slots.default;
            (data.isCompleted ? '撤回' : '完成');
            var __VLS_535;
            const __VLS_540 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_541 = __VLS_asFunctionalComponent(__VLS_540, new __VLS_540({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_542 = __VLS_541({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_541));
            let __VLS_544;
            let __VLS_545;
            let __VLS_546;
            const __VLS_547 = {
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
            __VLS_543.slots.default;
            var __VLS_543;
            const __VLS_548 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_549 = __VLS_asFunctionalComponent(__VLS_548, new __VLS_548({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }));
            const __VLS_550 = __VLS_549({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: "btn-subdivide" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_549));
            let __VLS_552;
            let __VLS_553;
            let __VLS_554;
            const __VLS_555 = {
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
            __VLS_551.slots.default;
            var __VLS_551;
            const __VLS_556 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_557 = __VLS_asFunctionalComponent(__VLS_556, new __VLS_556({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }));
            const __VLS_558 = __VLS_557({
                ...{ 'onClick': {} },
                size: "small",
                ...{ class: (data.active ? 'btn-disable' : 'btn-enable') },
            }, ...__VLS_functionalComponentArgsRest(__VLS_557));
            let __VLS_560;
            let __VLS_561;
            let __VLS_562;
            const __VLS_563 = {
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
            __VLS_559.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_559;
            const __VLS_564 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_565 = __VLS_asFunctionalComponent(__VLS_564, new __VLS_564({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_566 = __VLS_565({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_565));
            let __VLS_568;
            let __VLS_569;
            let __VLS_570;
            const __VLS_571 = {
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
            __VLS_567.slots.default;
            var __VLS_567;
        }
        var __VLS_479;
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
    const __VLS_572 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_573 = __VLS_asFunctionalComponent(__VLS_572, new __VLS_572({
        ...{ 'onClick': {} },
        plain: true,
    }));
    const __VLS_574 = __VLS_573({
        ...{ 'onClick': {} },
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_573));
    let __VLS_576;
    let __VLS_577;
    let __VLS_578;
    const __VLS_579 = {
        onClick: (__VLS_ctx.saveDraft)
    };
    __VLS_575.slots.default;
    var __VLS_575;
    const __VLS_580 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_581 = __VLS_asFunctionalComponent(__VLS_580, new __VLS_580({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }));
    const __VLS_582 = __VLS_581({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }, ...__VLS_functionalComponentArgsRest(__VLS_581));
    let __VLS_584;
    let __VLS_585;
    let __VLS_586;
    const __VLS_587 = {
        onClick: (__VLS_ctx.saveReviewToServer)
    };
    __VLS_583.slots.default;
    var __VLS_583;
    const __VLS_588 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_589 = __VLS_asFunctionalComponent(__VLS_588, new __VLS_588({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }));
    const __VLS_590 = __VLS_589({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }, ...__VLS_functionalComponentArgsRest(__VLS_589));
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
    const __VLS_592 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_593 = __VLS_asFunctionalComponent(__VLS_592, new __VLS_592({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }));
    const __VLS_594 = __VLS_593({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_593));
    let __VLS_596;
    let __VLS_597;
    let __VLS_598;
    const __VLS_599 = {
        onClick: (__VLS_ctx.loadReviews)
    };
    __VLS_595.slots.default;
    var __VLS_595;
    if (!__VLS_ctx.reviewHistory.length) {
        const __VLS_600 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_601 = __VLS_asFunctionalComponent(__VLS_600, new __VLS_600({
            description: "还没有历史回顾",
        }));
        const __VLS_602 = __VLS_601({
            description: "还没有历史回顾",
        }, ...__VLS_functionalComponentArgsRest(__VLS_601));
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
        const __VLS_604 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_605 = __VLS_asFunctionalComponent(__VLS_604, new __VLS_604({
            type: "warning",
        }));
        const __VLS_606 = __VLS_605({
            type: "warning",
        }, ...__VLS_functionalComponentArgsRest(__VLS_605));
        __VLS_607.slots.default;
        (__VLS_ctx.selectedReview.streakDays ?? 0);
        var __VLS_607;
        const __VLS_608 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_609 = __VLS_asFunctionalComponent(__VLS_608, new __VLS_608({
            type: "info",
        }));
        const __VLS_610 = __VLS_609({
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_609));
        __VLS_611.slots.default;
        (__VLS_ctx.formatDuration(__VLS_ctx.selectedReview.grossEffort));
        var __VLS_611;
    }
    else {
        const __VLS_612 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_613 = __VLS_asFunctionalComponent(__VLS_612, new __VLS_612({
            description: "请选择一条历史 review",
        }));
        const __VLS_614 = __VLS_613({
            description: "请选择一条历史 review",
        }, ...__VLS_functionalComponentArgsRest(__VLS_613));
    }
}
const __VLS_616 = {}.ElDialog;
/** @type {[typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, ]} */ ;
// @ts-ignore
const __VLS_617 = __VLS_asFunctionalComponent(__VLS_616, new __VLS_616({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: (['task-dialog', { 'view-mode': __VLS_ctx.taskDialogMode === 'view' }]) },
    destroyOnClose: true,
    appendToBody: true,
}));
const __VLS_618 = __VLS_617({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: (['task-dialog', { 'view-mode': __VLS_ctx.taskDialogMode === 'view' }]) },
    destroyOnClose: true,
    appendToBody: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_617));
let __VLS_620;
let __VLS_621;
let __VLS_622;
const __VLS_623 = {
    onClosed: (__VLS_ctx.resetTaskDialog)
};
__VLS_619.slots.default;
if (__VLS_ctx.taskDialogMode !== 'view' && !__VLS_ctx.isSceneDialog) {
    const __VLS_624 = {}.ElSteps;
    /** @type {[typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, ]} */ ;
    // @ts-ignore
    const __VLS_625 = __VLS_asFunctionalComponent(__VLS_624, new __VLS_624({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }));
    const __VLS_626 = __VLS_625({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_625));
    __VLS_627.slots.default;
    const __VLS_628 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_629 = __VLS_asFunctionalComponent(__VLS_628, new __VLS_628({
        title: "基本信息",
    }));
    const __VLS_630 = __VLS_629({
        title: "基本信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_629));
    const __VLS_632 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_633 = __VLS_asFunctionalComponent(__VLS_632, new __VLS_632({
        title: "时间信息",
    }));
    const __VLS_634 = __VLS_633({
        title: "时间信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_633));
    var __VLS_627;
}
if (__VLS_ctx.taskDialogMode !== 'view' && __VLS_ctx.taskDialogParent) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-parent-chip" },
    });
    if (String(__VLS_ctx.taskDialogParent.type) === '1') {
        const __VLS_636 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_637 = __VLS_asFunctionalComponent(__VLS_636, new __VLS_636({
            ...{ class: "task-type-icon task-type-icon-recurring" },
        }));
        const __VLS_638 = __VLS_637({
            ...{ class: "task-type-icon task-type-icon-recurring" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_637));
        __VLS_639.slots.default;
        const __VLS_640 = {}.Clock;
        /** @type {[typeof __VLS_components.Clock, ]} */ ;
        // @ts-ignore
        const __VLS_641 = __VLS_asFunctionalComponent(__VLS_640, new __VLS_640({}));
        const __VLS_642 = __VLS_641({}, ...__VLS_functionalComponentArgsRest(__VLS_641));
        var __VLS_639;
    }
    else if (String(__VLS_ctx.taskDialogParent.type) === '2') {
        const __VLS_644 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_645 = __VLS_asFunctionalComponent(__VLS_644, new __VLS_644({
            ...{ class: "task-type-icon task-type-icon-ddl" },
        }));
        const __VLS_646 = __VLS_645({
            ...{ class: "task-type-icon task-type-icon-ddl" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_645));
        __VLS_647.slots.default;
        const __VLS_648 = {}.Calendar;
        /** @type {[typeof __VLS_components.Calendar, ]} */ ;
        // @ts-ignore
        const __VLS_649 = __VLS_asFunctionalComponent(__VLS_648, new __VLS_648({}));
        const __VLS_650 = __VLS_649({}, ...__VLS_functionalComponentArgsRest(__VLS_649));
        var __VLS_647;
    }
    else {
        const __VLS_652 = {}.ElIcon;
        /** @type {[typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, typeof __VLS_components.ElIcon, typeof __VLS_components.elIcon, ]} */ ;
        // @ts-ignore
        const __VLS_653 = __VLS_asFunctionalComponent(__VLS_652, new __VLS_652({
            ...{ class: "task-type-icon task-type-icon-note" },
        }));
        const __VLS_654 = __VLS_653({
            ...{ class: "task-type-icon task-type-icon-note" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_653));
        __VLS_655.slots.default;
        const __VLS_656 = {}.Document;
        /** @type {[typeof __VLS_components.Document, ]} */ ;
        // @ts-ignore
        const __VLS_657 = __VLS_asFunctionalComponent(__VLS_656, new __VLS_656({}));
        const __VLS_658 = __VLS_657({}, ...__VLS_functionalComponentArgsRest(__VLS_657));
        var __VLS_655;
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.taskDialogParent.title);
}
if (__VLS_ctx.taskDialogMode !== 'view') {
    for (const [warning] of __VLS_getVForSourceType((__VLS_ctx.taskDialogWarnings))) {
        const __VLS_660 = {}.ElAlert;
        /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
        // @ts-ignore
        const __VLS_661 = __VLS_asFunctionalComponent(__VLS_660, new __VLS_660({
            key: (warning),
            title: (warning),
            type: "warning",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }));
        const __VLS_662 = __VLS_661({
            key: (warning),
            title: (warning),
            type: "warning",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_661));
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
    const __VLS_664 = {}.ElForm;
    /** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
    // @ts-ignore
    const __VLS_665 = __VLS_asFunctionalComponent(__VLS_664, new __VLS_664({
        ...{ 'onSubmit': {} },
        ref: "taskFormRef",
        model: (__VLS_ctx.taskForm),
        rules: (__VLS_ctx.taskFormRules),
        labelPosition: "top",
        ...{ class: "task-dialog-form" },
    }));
    const __VLS_666 = __VLS_665({
        ...{ 'onSubmit': {} },
        ref: "taskFormRef",
        model: (__VLS_ctx.taskForm),
        rules: (__VLS_ctx.taskFormRules),
        labelPosition: "top",
        ...{ class: "task-dialog-form" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_665));
    let __VLS_668;
    let __VLS_669;
    let __VLS_670;
    const __VLS_671 = {
        onSubmit: () => { }
    };
    /** @type {typeof __VLS_ctx.taskFormRef} */ ;
    var __VLS_672 = {};
    __VLS_667.slots.default;
    if (__VLS_ctx.isSceneDialog) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-page" },
        });
        const __VLS_674 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_675 = __VLS_asFunctionalComponent(__VLS_674, new __VLS_674({
            label: "场景标题",
            prop: "title",
        }));
        const __VLS_676 = __VLS_675({
            label: "场景标题",
            prop: "title",
        }, ...__VLS_functionalComponentArgsRest(__VLS_675));
        __VLS_677.slots.default;
        const __VLS_678 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_679 = __VLS_asFunctionalComponent(__VLS_678, new __VLS_678({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入场景标题",
            maxlength: "120",
            showWordLimit: true,
        }));
        const __VLS_680 = __VLS_679({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入场景标题",
            maxlength: "120",
            showWordLimit: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_679));
        var __VLS_677;
        const __VLS_682 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_683 = __VLS_asFunctionalComponent(__VLS_682, new __VLS_682({
            label: "场景描述（可选）",
            prop: "description",
        }));
        const __VLS_684 = __VLS_683({
            label: "场景描述（可选）",
            prop: "description",
        }, ...__VLS_functionalComponentArgsRest(__VLS_683));
        __VLS_685.slots.default;
        const __VLS_686 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_687 = __VLS_asFunctionalComponent(__VLS_686, new __VLS_686({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (5),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充场景说明",
        }));
        const __VLS_688 = __VLS_687({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (5),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充场景说明",
        }, ...__VLS_functionalComponentArgsRest(__VLS_687));
        var __VLS_685;
        const __VLS_690 = {}.ElAlert;
        /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
        // @ts-ignore
        const __VLS_691 = __VLS_asFunctionalComponent(__VLS_690, new __VLS_690({
            title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
            type: "info",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }));
        const __VLS_692 = __VLS_691({
            title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
            type: "info",
            showIcon: true,
            closable: (false),
            ...{ class: "task-dialog-alert" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_691));
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-page" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.taskDialogStep === 0) }, null, null);
        const __VLS_694 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_695 = __VLS_asFunctionalComponent(__VLS_694, new __VLS_694({
            label: "标题",
            prop: "title",
        }));
        const __VLS_696 = __VLS_695({
            label: "标题",
            prop: "title",
        }, ...__VLS_functionalComponentArgsRest(__VLS_695));
        __VLS_697.slots.default;
        const __VLS_698 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_699 = __VLS_asFunctionalComponent(__VLS_698, new __VLS_698({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入任务标题",
            maxlength: "120",
            showWordLimit: true,
        }));
        const __VLS_700 = __VLS_699({
            modelValue: (__VLS_ctx.taskForm.title),
            placeholder: "请输入任务标题",
            maxlength: "120",
            showWordLimit: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_699));
        var __VLS_697;
        const __VLS_702 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_703 = __VLS_asFunctionalComponent(__VLS_702, new __VLS_702({
            label: "描述（可选）",
            prop: "description",
        }));
        const __VLS_704 = __VLS_703({
            label: "描述（可选）",
            prop: "description",
        }, ...__VLS_functionalComponentArgsRest(__VLS_703));
        __VLS_705.slots.default;
        const __VLS_706 = {}.ElInput;
        /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
        // @ts-ignore
        const __VLS_707 = __VLS_asFunctionalComponent(__VLS_706, new __VLS_706({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (4),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充任务说明",
        }));
        const __VLS_708 = __VLS_707({
            modelValue: (__VLS_ctx.taskForm.description),
            type: "textarea",
            rows: (4),
            maxlength: "500",
            showWordLimit: true,
            placeholder: "补充任务说明",
        }, ...__VLS_functionalComponentArgsRest(__VLS_707));
        var __VLS_705;
        const __VLS_710 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_711 = __VLS_asFunctionalComponent(__VLS_710, new __VLS_710({
            gutter: (14),
        }));
        const __VLS_712 = __VLS_711({
            gutter: (14),
        }, ...__VLS_functionalComponentArgsRest(__VLS_711));
        __VLS_713.slots.default;
        const __VLS_714 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_715 = __VLS_asFunctionalComponent(__VLS_714, new __VLS_714({
            xs: (24),
            sm: (12),
        }));
        const __VLS_716 = __VLS_715({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_715));
        __VLS_717.slots.default;
        const __VLS_718 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_719 = __VLS_asFunctionalComponent(__VLS_718, new __VLS_718({
            label: "类型",
            prop: "type",
        }));
        const __VLS_720 = __VLS_719({
            label: "类型",
            prop: "type",
        }, ...__VLS_functionalComponentArgsRest(__VLS_719));
        __VLS_721.slots.default;
        if (__VLS_ctx.taskForm.type !== 3) {
            const __VLS_722 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_723 = __VLS_asFunctionalComponent(__VLS_722, new __VLS_722({
                modelValue: (__VLS_ctx.taskForm.type),
                ...{ class: "w-full" },
            }));
            const __VLS_724 = __VLS_723({
                modelValue: (__VLS_ctx.taskForm.type),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_723));
            __VLS_725.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.taskTypeOptions))) {
                const __VLS_726 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_727 = __VLS_asFunctionalComponent(__VLS_726, new __VLS_726({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_728 = __VLS_727({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_727));
            }
            var __VLS_725;
        }
        else {
            const __VLS_730 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_731 = __VLS_asFunctionalComponent(__VLS_730, new __VLS_730({
                type: "warning",
            }));
            const __VLS_732 = __VLS_731({
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_731));
            __VLS_733.slots.default;
            var __VLS_733;
        }
        var __VLS_721;
        var __VLS_717;
        var __VLS_713;
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
            const __VLS_734 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_735 = __VLS_asFunctionalComponent(__VLS_734, new __VLS_734({
                gutter: (14),
                ...{ class: "task-recurrence-row" },
            }));
            const __VLS_736 = __VLS_735({
                gutter: (14),
                ...{ class: "task-recurrence-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_735));
            __VLS_737.slots.default;
            const __VLS_738 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_739 = __VLS_asFunctionalComponent(__VLS_738, new __VLS_738({
                xs: (24),
                sm: (10),
            }));
            const __VLS_740 = __VLS_739({
                xs: (24),
                sm: (10),
            }, ...__VLS_functionalComponentArgsRest(__VLS_739));
            __VLS_741.slots.default;
            const __VLS_742 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_743 = __VLS_asFunctionalComponent(__VLS_742, new __VLS_742({
                label: "循环尺度",
                prop: "cycleMode",
            }));
            const __VLS_744 = __VLS_743({
                label: "循环尺度",
                prop: "cycleMode",
            }, ...__VLS_functionalComponentArgsRest(__VLS_743));
            __VLS_745.slots.default;
            const __VLS_746 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_747 = __VLS_asFunctionalComponent(__VLS_746, new __VLS_746({
                modelValue: (__VLS_ctx.taskForm.cycleMode),
                ...{ class: "w-full" },
            }));
            const __VLS_748 = __VLS_747({
                modelValue: (__VLS_ctx.taskForm.cycleMode),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_747));
            __VLS_749.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.cycleModeOptions))) {
                const __VLS_750 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_751 = __VLS_asFunctionalComponent(__VLS_750, new __VLS_750({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_752 = __VLS_751({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_751));
            }
            var __VLS_749;
            var __VLS_745;
            var __VLS_741;
            const __VLS_754 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_755 = __VLS_asFunctionalComponent(__VLS_754, new __VLS_754({
                xs: (24),
                sm: (14),
            }));
            const __VLS_756 = __VLS_755({
                xs: (24),
                sm: (14),
            }, ...__VLS_functionalComponentArgsRest(__VLS_755));
            __VLS_757.slots.default;
            if (__VLS_ctx.taskForm.cycleMode === 'interval') {
                const __VLS_758 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_759 = __VLS_asFunctionalComponent(__VLS_758, new __VLS_758({
                    label: "具体选择",
                    prop: "cycleIntervalDays",
                }));
                const __VLS_760 = __VLS_759({
                    label: "具体选择",
                    prop: "cycleIntervalDays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_759));
                __VLS_761.slots.default;
                const __VLS_762 = {}.ElInputNumber;
                /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
                // @ts-ignore
                const __VLS_763 = __VLS_asFunctionalComponent(__VLS_762, new __VLS_762({
                    modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                    min: (1),
                    step: (1),
                    controlsPosition: "right",
                    ...{ class: "w-full" },
                }));
                const __VLS_764 = __VLS_763({
                    modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                    min: (1),
                    step: (1),
                    controlsPosition: "right",
                    ...{ class: "w-full" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_763));
                var __VLS_761;
            }
            else if (__VLS_ctx.taskForm.cycleMode === 'weekly') {
                const __VLS_766 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_767 = __VLS_asFunctionalComponent(__VLS_766, new __VLS_766({
                    label: "具体选择",
                    prop: "cycleWeekdays",
                }));
                const __VLS_768 = __VLS_767({
                    label: "具体选择",
                    prop: "cycleWeekdays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_767));
                __VLS_769.slots.default;
                const __VLS_770 = {}.ElSelect;
                /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
                // @ts-ignore
                const __VLS_771 = __VLS_asFunctionalComponent(__VLS_770, new __VLS_770({
                    modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个星期",
                }));
                const __VLS_772 = __VLS_771({
                    modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个星期",
                }, ...__VLS_functionalComponentArgsRest(__VLS_771));
                __VLS_773.slots.default;
                for (const [option] of __VLS_getVForSourceType((__VLS_ctx.weekdayOptions))) {
                    const __VLS_774 = {}.ElOption;
                    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                    // @ts-ignore
                    const __VLS_775 = __VLS_asFunctionalComponent(__VLS_774, new __VLS_774({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }));
                    const __VLS_776 = __VLS_775({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }, ...__VLS_functionalComponentArgsRest(__VLS_775));
                }
                var __VLS_773;
                var __VLS_769;
            }
            else if (__VLS_ctx.taskForm.cycleMode === 'monthly') {
                const __VLS_778 = {}.ElFormItem;
                /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
                // @ts-ignore
                const __VLS_779 = __VLS_asFunctionalComponent(__VLS_778, new __VLS_778({
                    label: "具体选择",
                    prop: "cycleMonthDays",
                }));
                const __VLS_780 = __VLS_779({
                    label: "具体选择",
                    prop: "cycleMonthDays",
                }, ...__VLS_functionalComponentArgsRest(__VLS_779));
                __VLS_781.slots.default;
                const __VLS_782 = {}.ElSelect;
                /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
                // @ts-ignore
                const __VLS_783 = __VLS_asFunctionalComponent(__VLS_782, new __VLS_782({
                    modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个日期",
                }));
                const __VLS_784 = __VLS_783({
                    modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                    multiple: true,
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    ...{ class: "w-full" },
                    placeholder: "选择一个或多个日期",
                }, ...__VLS_functionalComponentArgsRest(__VLS_783));
                __VLS_785.slots.default;
                for (const [option] of __VLS_getVForSourceType((__VLS_ctx.monthDayOptions))) {
                    const __VLS_786 = {}.ElOption;
                    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                    // @ts-ignore
                    const __VLS_787 = __VLS_asFunctionalComponent(__VLS_786, new __VLS_786({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }));
                    const __VLS_788 = __VLS_787({
                        key: (option.value),
                        label: (option.label),
                        value: (option.value),
                    }, ...__VLS_functionalComponentArgsRest(__VLS_787));
                }
                var __VLS_785;
                var __VLS_781;
            }
            var __VLS_757;
            var __VLS_737;
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
        const __VLS_790 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_791 = __VLS_asFunctionalComponent(__VLS_790, new __VLS_790({
            gutter: (14),
            ...{ class: "task-duration-row" },
        }));
        const __VLS_792 = __VLS_791({
            gutter: (14),
            ...{ class: "task-duration-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_791));
        __VLS_793.slots.default;
        const __VLS_794 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_795 = __VLS_asFunctionalComponent(__VLS_794, new __VLS_794({
            xs: (24),
            sm: (12),
        }));
        const __VLS_796 = __VLS_795({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_795));
        __VLS_797.slots.default;
        const __VLS_798 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_799 = __VLS_asFunctionalComponent(__VLS_798, new __VLS_798({
            label: "小时",
            prop: "planDurationHours",
        }));
        const __VLS_800 = __VLS_799({
            label: "小时",
            prop: "planDurationHours",
        }, ...__VLS_functionalComponentArgsRest(__VLS_799));
        __VLS_801.slots.default;
        const __VLS_802 = {}.ElInputNumber;
        /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_803 = __VLS_asFunctionalComponent(__VLS_802, new __VLS_802({
            modelValue: (__VLS_ctx.taskForm.planDurationHours),
            min: (0),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }));
        const __VLS_804 = __VLS_803({
            modelValue: (__VLS_ctx.taskForm.planDurationHours),
            min: (0),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_803));
        var __VLS_801;
        var __VLS_797;
        const __VLS_806 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_807 = __VLS_asFunctionalComponent(__VLS_806, new __VLS_806({
            xs: (24),
            sm: (12),
        }));
        const __VLS_808 = __VLS_807({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_807));
        __VLS_809.slots.default;
        const __VLS_810 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_811 = __VLS_asFunctionalComponent(__VLS_810, new __VLS_810({
            label: "分钟",
            prop: "planDurationMinutes",
        }));
        const __VLS_812 = __VLS_811({
            label: "分钟",
            prop: "planDurationMinutes",
        }, ...__VLS_functionalComponentArgsRest(__VLS_811));
        __VLS_813.slots.default;
        const __VLS_814 = {}.ElInputNumber;
        /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_815 = __VLS_asFunctionalComponent(__VLS_814, new __VLS_814({
            modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
            min: (0),
            max: (59),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }));
        const __VLS_816 = __VLS_815({
            modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
            min: (0),
            max: (59),
            step: (1),
            controlsPosition: "right",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_815));
        var __VLS_813;
        var __VLS_809;
        var __VLS_793;
        if (__VLS_ctx.isRecurringTask) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-title" },
            });
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
            const __VLS_826 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_827 = __VLS_asFunctionalComponent(__VLS_826, new __VLS_826({
                label: "开始时分",
            }));
            const __VLS_828 = __VLS_827({
                label: "开始时分",
            }, ...__VLS_functionalComponentArgsRest(__VLS_827));
            __VLS_829.slots.default;
            const __VLS_830 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_831 = __VLS_asFunctionalComponent(__VLS_830, new __VLS_830({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_832 = __VLS_831({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_831));
            let __VLS_834;
            let __VLS_835;
            let __VLS_836;
            const __VLS_837 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
            };
            var __VLS_833;
            var __VLS_829;
            var __VLS_825;
            const __VLS_838 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_839 = __VLS_asFunctionalComponent(__VLS_838, new __VLS_838({
                xs: (24),
                sm: (12),
            }));
            const __VLS_840 = __VLS_839({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_839));
            __VLS_841.slots.default;
            const __VLS_842 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_843 = __VLS_asFunctionalComponent(__VLS_842, new __VLS_842({
                label: "结束时分",
            }));
            const __VLS_844 = __VLS_843({
                label: "结束时分",
            }, ...__VLS_functionalComponentArgsRest(__VLS_843));
            __VLS_845.slots.default;
            const __VLS_846 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_847 = __VLS_asFunctionalComponent(__VLS_846, new __VLS_846({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_848 = __VLS_847({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_847));
            let __VLS_850;
            let __VLS_851;
            let __VLS_852;
            const __VLS_853 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
            };
            var __VLS_849;
            var __VLS_845;
            var __VLS_841;
            var __VLS_821;
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-block" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-dialog-section-title" },
            });
            const __VLS_854 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_855 = __VLS_asFunctionalComponent(__VLS_854, new __VLS_854({
                label: "开始时间",
                prop: "startTime",
            }));
            const __VLS_856 = __VLS_855({
                label: "开始时间",
                prop: "startTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_855));
            __VLS_857.slots.default;
            const __VLS_858 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_859 = __VLS_asFunctionalComponent(__VLS_858, new __VLS_858({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }));
            const __VLS_860 = __VLS_859({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_859));
            __VLS_861.slots.default;
            const __VLS_862 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_863 = __VLS_asFunctionalComponent(__VLS_862, new __VLS_862({
                xs: (24),
                sm: (12),
            }));
            const __VLS_864 = __VLS_863({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_863));
            __VLS_865.slots.default;
            const __VLS_866 = {}.ElDatePicker;
            /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
            // @ts-ignore
            const __VLS_867 = __VLS_asFunctionalComponent(__VLS_866, new __VLS_866({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }));
            const __VLS_868 = __VLS_867({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_867));
            let __VLS_870;
            let __VLS_871;
            let __VLS_872;
            const __VLS_873 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartDatePart)
            };
            var __VLS_869;
            var __VLS_865;
            const __VLS_874 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_875 = __VLS_asFunctionalComponent(__VLS_874, new __VLS_874({
                xs: (24),
                sm: (12),
            }));
            const __VLS_876 = __VLS_875({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_875));
            __VLS_877.slots.default;
            const __VLS_878 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_879 = __VLS_asFunctionalComponent(__VLS_878, new __VLS_878({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_880 = __VLS_879({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_879));
            let __VLS_882;
            let __VLS_883;
            let __VLS_884;
            const __VLS_885 = {
                'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
            };
            var __VLS_881;
            var __VLS_877;
            var __VLS_861;
            var __VLS_857;
            const __VLS_886 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_887 = __VLS_asFunctionalComponent(__VLS_886, new __VLS_886({
                label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
                prop: "endTime",
            }));
            const __VLS_888 = __VLS_887({
                label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
                prop: "endTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_887));
            __VLS_889.slots.default;
            const __VLS_890 = {}.ElRow;
            /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
            // @ts-ignore
            const __VLS_891 = __VLS_asFunctionalComponent(__VLS_890, new __VLS_890({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }));
            const __VLS_892 = __VLS_891({
                gutter: (10),
                ...{ class: "task-datetime-row" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_891));
            __VLS_893.slots.default;
            const __VLS_894 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_895 = __VLS_asFunctionalComponent(__VLS_894, new __VLS_894({
                xs: (24),
                sm: (12),
            }));
            const __VLS_896 = __VLS_895({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_895));
            __VLS_897.slots.default;
            const __VLS_898 = {}.ElDatePicker;
            /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
            // @ts-ignore
            const __VLS_899 = __VLS_asFunctionalComponent(__VLS_898, new __VLS_898({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }));
            const __VLS_900 = __VLS_899({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
                type: "date",
                format: "YYYY-MM-DD",
                valueFormat: "YYYY-MM-DD",
                placeholder: "选择日期",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_899));
            let __VLS_902;
            let __VLS_903;
            let __VLS_904;
            const __VLS_905 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndDatePart)
            };
            var __VLS_901;
            var __VLS_897;
            const __VLS_906 = {}.ElCol;
            /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
            // @ts-ignore
            const __VLS_907 = __VLS_asFunctionalComponent(__VLS_906, new __VLS_906({
                xs: (24),
                sm: (12),
            }));
            const __VLS_908 = __VLS_907({
                xs: (24),
                sm: (12),
            }, ...__VLS_functionalComponentArgsRest(__VLS_907));
            __VLS_909.slots.default;
            const __VLS_910 = {}.ElTimePicker;
            /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
            // @ts-ignore
            const __VLS_911 = __VLS_asFunctionalComponent(__VLS_910, new __VLS_910({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }));
            const __VLS_912 = __VLS_911({
                ...{ 'onUpdate:modelValue': {} },
                modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
                format: "HH:mm",
                valueFormat: "HH:mm:ss",
                placeholder: "选择时分",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_911));
            let __VLS_914;
            let __VLS_915;
            let __VLS_916;
            const __VLS_917 = {
                'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
            };
            var __VLS_913;
            var __VLS_909;
            var __VLS_893;
            var __VLS_889;
        }
        if (String(__VLS_ctx.taskForm.type) !== '0') {
            const __VLS_918 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_919 = __VLS_asFunctionalComponent(__VLS_918, new __VLS_918({
                prop: "settlementType",
            }));
            const __VLS_920 = __VLS_919({
                prop: "settlementType",
            }, ...__VLS_functionalComponentArgsRest(__VLS_919));
            __VLS_921.slots.default;
            {
                const { label: __VLS_thisSlot } = __VLS_921.slots;
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-settlement-label" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                const __VLS_922 = {}.ElTooltip;
                /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
                // @ts-ignore
                const __VLS_923 = __VLS_asFunctionalComponent(__VLS_922, new __VLS_922({
                    effect: "dark",
                    placement: "top",
                    rawContent: true,
                    content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
                }));
                const __VLS_924 = __VLS_923({
                    effect: "dark",
                    placement: "top",
                    rawContent: true,
                    content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
                }, ...__VLS_functionalComponentArgsRest(__VLS_923));
                __VLS_925.slots.default;
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "task-settlement-help" },
                    'aria-label': "结算模式说明",
                });
                var __VLS_925;
            }
            const __VLS_926 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_927 = __VLS_asFunctionalComponent(__VLS_926, new __VLS_926({
                modelValue: (__VLS_ctx.taskForm.settlementType),
                ...{ class: "w-full" },
            }));
            const __VLS_928 = __VLS_927({
                modelValue: (__VLS_ctx.taskForm.settlementType),
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_927));
            __VLS_929.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.settlementTypeOptions))) {
                const __VLS_930 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_931 = __VLS_asFunctionalComponent(__VLS_930, new __VLS_930({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_932 = __VLS_931({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_931));
            }
            var __VLS_929;
            var __VLS_921;
        }
        if (__VLS_ctx.taskDialogParent) {
            const __VLS_934 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_935 = __VLS_asFunctionalComponent(__VLS_934, new __VLS_934({
                label: "是否同步时长到父任务",
                prop: "inheritParentTime",
            }));
            const __VLS_936 = __VLS_935({
                label: "是否同步时长到父任务",
                prop: "inheritParentTime",
            }, ...__VLS_functionalComponentArgsRest(__VLS_935));
            __VLS_937.slots.default;
            const __VLS_938 = {}.ElSwitch;
            /** @type {[typeof __VLS_components.ElSwitch, typeof __VLS_components.elSwitch, ]} */ ;
            // @ts-ignore
            const __VLS_939 = __VLS_asFunctionalComponent(__VLS_938, new __VLS_938({
                modelValue: (__VLS_ctx.taskForm.inheritParentTime),
                activeText: "同步",
                inactiveText: "不计入",
            }));
            const __VLS_940 = __VLS_939({
                modelValue: (__VLS_ctx.taskForm.inheritParentTime),
                activeText: "同步",
                inactiveText: "不计入",
            }, ...__VLS_functionalComponentArgsRest(__VLS_939));
            var __VLS_937;
        }
    }
    var __VLS_667;
}
{
    const { footer: __VLS_thisSlot } = __VLS_619.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-footer" },
    });
    const __VLS_942 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_943 = __VLS_asFunctionalComponent(__VLS_942, new __VLS_942({
        ...{ 'onClick': {} },
    }));
    const __VLS_944 = __VLS_943({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_943));
    let __VLS_946;
    let __VLS_947;
    let __VLS_948;
    const __VLS_949 = {
        onClick: (...[$event]) => {
            __VLS_ctx.taskDialogVisible = false;
        }
    };
    __VLS_945.slots.default;
    var __VLS_945;
    if (__VLS_ctx.taskDialogMode === 'view') {
    }
    else {
        if (__VLS_ctx.isSceneDialog) {
            const __VLS_950 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_951 = __VLS_asFunctionalComponent(__VLS_950, new __VLS_950({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }));
            const __VLS_952 = __VLS_951({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }, ...__VLS_functionalComponentArgsRest(__VLS_951));
            let __VLS_954;
            let __VLS_955;
            let __VLS_956;
            const __VLS_957 = {
                onClick: (__VLS_ctx.submitTaskDialog)
            };
            __VLS_953.slots.default;
            var __VLS_953;
        }
        else {
            if (__VLS_ctx.taskDialogStep > 0) {
                const __VLS_958 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_959 = __VLS_asFunctionalComponent(__VLS_958, new __VLS_958({
                    ...{ 'onClick': {} },
                }));
                const __VLS_960 = __VLS_959({
                    ...{ 'onClick': {} },
                }, ...__VLS_functionalComponentArgsRest(__VLS_959));
                let __VLS_962;
                let __VLS_963;
                let __VLS_964;
                const __VLS_965 = {
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
                __VLS_961.slots.default;
                var __VLS_961;
            }
            if (__VLS_ctx.taskDialogStep === 0) {
                const __VLS_966 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_967 = __VLS_asFunctionalComponent(__VLS_966, new __VLS_966({
                    ...{ 'onClick': {} },
                    type: "warning",
                }));
                const __VLS_968 = __VLS_967({
                    ...{ 'onClick': {} },
                    type: "warning",
                }, ...__VLS_functionalComponentArgsRest(__VLS_967));
                let __VLS_970;
                let __VLS_971;
                let __VLS_972;
                const __VLS_973 = {
                    onClick: (__VLS_ctx.goTaskDialogNext)
                };
                __VLS_969.slots.default;
                var __VLS_969;
            }
            else {
                const __VLS_974 = {}.ElButton;
                /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
                // @ts-ignore
                const __VLS_975 = __VLS_asFunctionalComponent(__VLS_974, new __VLS_974({
                    ...{ 'onClick': {} },
                    type: "warning",
                    loading: (__VLS_ctx.taskDialogLoading),
                }));
                const __VLS_976 = __VLS_975({
                    ...{ 'onClick': {} },
                    type: "warning",
                    loading: (__VLS_ctx.taskDialogLoading),
                }, ...__VLS_functionalComponentArgsRest(__VLS_975));
                let __VLS_978;
                let __VLS_979;
                let __VLS_980;
                const __VLS_981 = {
                    onClick: (__VLS_ctx.submitTaskDialog)
                };
                __VLS_977.slots.default;
                var __VLS_977;
            }
        }
    }
}
var __VLS_619;
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
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta-inline']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta-inline']} */ ;
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
/** @type {__VLS_StyleScopedClasses['btn-subdivide']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta-inline']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-clock']} */ ;
/** @type {__VLS_StyleScopedClasses['task-run-toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-clock-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta-inline']} */ ;
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
var __VLS_673 = __VLS_672;
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
            heartbeatPercent: heartbeatPercent,
            heartbeatTooltip: heartbeatTooltip,
            runStatusTooltip: runStatusTooltip,
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
