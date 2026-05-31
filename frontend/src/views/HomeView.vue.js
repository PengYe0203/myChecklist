import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { createTaskApi, deleteTaskApi, getAllTasksApi, updateTaskApi, toggleActiveApi, toggleCompleteApi, } from '@/api/task';
import { editReviewApi, getAllReviewsApi } from '@/api/review';
const router = useRouter();
const authStore = useAuthStore();
const activeSection = ref('today');
const loadingTasks = ref(false);
const savingReview = ref(false);
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
const taskTypeOptions = [
    { label: '随手记', value: 0 },
    { label: '周期任务', value: 1 },
    { label: 'DDL', value: 2 },
];
const recurringDefaultTime = '04:00:00';
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
    const defaultStartTime = normalizedType === 1
        ? (sourceTask?.startTime ? resolveDefaultDateTime(sourceTask.startTime) : parentTask?.startTime ? resolveDefaultDateTime(parentTask.startTime) : '')
        : (sourceTask?.startTime ? resolveDefaultDateTime(sourceTask.startTime) : parentTask?.startTime ? resolveDefaultDateTime(parentTask.startTime) : '');
    const defaultEndTime = normalizedType === 1
        ? (sourceTask?.endTime ? resolveDefaultDateTime(sourceTask.endTime) : parentTask?.endTime ? resolveDefaultDateTime(parentTask.endTime) : '')
        : (sourceTask?.endTime ? resolveDefaultDateTime(sourceTask.endTime) : parentTask?.endTime ? resolveDefaultDateTime(parentTask.endTime) : '');
    const form = {
        taskId: sourceTask?.taskId ?? null,
        parentId: sourceTask ? (sourceTask.parentId ?? null) : (parentTask?.taskId ?? null),
        title: sourceTask?.title ?? '',
        description: sourceTask?.description ?? '',
        type: normalizedType,
        settlementType: Number.isFinite(sourceSettlement) ? sourceSettlement : 0,
        planDurationHours: Math.floor(totalMinutes / 60),
        planDurationMinutes: totalMinutes % 60,
        startTime: defaultStartTime,
        endTime: defaultEndTime,
        cycleMode: parsedCron?.cycleMode ?? 'interval',
        cycleIntervalDays: parsedCron?.cycleIntervalDays ?? 1,
        cycleWeekdays: parsedCron?.cycleWeekdays ?? [],
        cycleMonthDays: parsedCron?.cycleMonthDays ?? [],
        inheritParentTime: sourceTask?.inheritParentTime ?? false,
        active: sourceTask?.active ?? defaultActive,
        isCompleted: sourceTask?.isCompleted ?? false,
    };
    return form;
};
const taskForm = reactive(createDefaultTaskForm());
const displayUsername = computed(() => authStore.username || '未命名用户');
const isRecurringTask = computed(() => String(taskForm.type) === '1');
const taskDialogTitle = computed(() => {
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
watch(() => taskForm.type, (type) => {
    if (String(type) === '0') {
        taskForm.settlementType = 0;
    }
    if (String(type) !== '1') {
        taskForm.cycleMode = 'interval';
        taskForm.cycleIntervalDays = 1;
        taskForm.cycleWeekdays = [];
        taskForm.cycleMonthDays = [];
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
const todayKey = computed(() => formatDateKey(new Date()));
const draftStorageKey = computed(() => `mychecklist-review-draft-${todayKey.value}`);
const todayLabel = computed(() => {
    const date = new Date();
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
    taskDialogStep.value = 0;
    taskDialogVisible.value = true;
};
const openCreateSceneDialog = () => {
    taskDialogMode.value = 'create';
    taskDialogParent.value = null;
    Object.assign(taskForm, createDefaultTaskForm(null, null, 3, true));
    taskDialogStep.value = 0;
    taskDialogVisible.value = true;
};
const openEditTaskDialog = (task) => {
    taskDialogMode.value = 'edit';
    taskDialogParent.value = findTaskById(task.parentId);
    Object.assign(taskForm, createDefaultTaskForm(taskDialogParent.value, task));
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
            return undefined;
        return value.includes('T') ? value : value.replace(' ', 'T');
    };
    const normalizeRecurringDateTimeForApi = (value) => {
        if (!value)
            return undefined;
        if (value.includes('T'))
            return value;
        if (value.includes(' '))
            return value.replace(' ', 'T');
        return `${getTodayDatePart()}T${value.length === 5 ? `${value}:00` : value}`;
    };
    const payload = {
        taskId: taskForm.taskId ?? undefined,
        parentId: taskForm.parentId ?? undefined,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || undefined,
        type: String(taskForm.type),
        settlementType: String(taskForm.settlementType),
        targetDuration: totalDurationSeconds,
        startTime: String(taskForm.type) === '1' ? normalizeRecurringDateTimeForApi(taskForm.startTime) : normalizeDateTimeForApi(taskForm.startTime),
        endTime: String(taskForm.type) === '1' ? normalizeRecurringDateTimeForApi(taskForm.endTime) : normalizeDateTimeForApi(taskForm.endTime),
        cronConfig: buildCronConfig(),
        inheritParentTime: taskDialogParent.value ? taskForm.inheritParentTime : undefined,
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
        taskForm[field] = combineDateWithTime(timeValue);
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
const formatDateKey = (value) => {
    const date = typeof value === 'string' ? new Date(value) : value;
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    return formatDateKey(task.endTime) === todayKey.value;
};
const isTodoTask = (task) => Boolean(task.active) && !Boolean(task.isCompleted);
const isTodoTodayTask = (task) => {
    if (!isTodoTask(task))
        return false;
    if (!task.endTime)
        return false;
    return formatDateKey(task.endTime) === todayKey.value;
};
const isTodoFutureTask = (task) => {
    if (!isTodoTask(task))
        return false;
    if (!task.endTime)
        return true;
    return formatDateKey(task.endTime) !== todayKey.value;
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
});
watch(reviewDraft, (value) => {
    window.localStorage.setItem(draftStorageKey.value, value);
});
onBeforeUnmount(() => {
    if (reviewDraft.value.trim()) {
        syncReviewDraft();
    }
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
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__content']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__content']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node__content']} */ ;
/** @type {__VLS_StyleScopedClasses['task-tree']} */ ;
/** @type {__VLS_StyleScopedClasses['el-tree-node']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-top']} */ ;
/** @type {__VLS_StyleScopedClasses['review-item-top']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['detail-item']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-parent-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog']} */ ;
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
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }));
        const __VLS_30 = __VLS_29({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
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
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_32 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }));
            const __VLS_34 = __VLS_33({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_33));
            __VLS_35.slots.default;
            (__VLS_ctx.taskTypeLabel(data.type));
            var __VLS_35;
            const __VLS_36 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }));
            const __VLS_38 = __VLS_37({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_37));
            __VLS_39.slots.default;
            (data.isCompleted ? '已完成' : data.active ? '激活中' : '未激活');
            var __VLS_39;
            const __VLS_40 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }));
            const __VLS_42 = __VLS_41({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_41));
            let __VLS_44;
            let __VLS_45;
            let __VLS_46;
            const __VLS_47 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_43.slots.default;
            var __VLS_43;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-meta" },
            });
            if (data.description) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (data.description);
            }
            if (data.startTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.startTime));
            }
            if (data.endTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.endTime));
            }
            if (data.targetDuration) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDuration(data.targetDuration));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_48 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }));
            const __VLS_50 = __VLS_49({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_49));
            let __VLS_52;
            let __VLS_53;
            let __VLS_54;
            const __VLS_55 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_51.slots.default;
            (data.isCompleted ? '取消完成' : '完成');
            var __VLS_51;
            const __VLS_56 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_58 = __VLS_57({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_57));
            let __VLS_60;
            let __VLS_61;
            let __VLS_62;
            const __VLS_63 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_59.slots.default;
            var __VLS_59;
            const __VLS_64 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }));
            const __VLS_66 = __VLS_65({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_65));
            let __VLS_68;
            let __VLS_69;
            let __VLS_70;
            const __VLS_71 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_67.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_67;
            const __VLS_72 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_74 = __VLS_73({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_73));
            let __VLS_76;
            let __VLS_77;
            let __VLS_78;
            const __VLS_79 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'today'))
                        return;
                    if (!!(!__VLS_ctx.currentTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_75.slots.default;
            var __VLS_75;
        }
        var __VLS_31;
    }
}
if (__VLS_ctx.activeSection === 'todo') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "section-toolbar section-toolbar-left" },
    });
    const __VLS_80 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_82 = __VLS_81({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_81));
    let __VLS_84;
    let __VLS_85;
    let __VLS_86;
    const __VLS_87 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.activeSection === 'todo'))
                return;
            __VLS_ctx.openCreateTaskDialog();
        }
    };
    __VLS_83.slots.default;
    var __VLS_83;
    const __VLS_88 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_89 = __VLS_asFunctionalComponent(__VLS_88, new __VLS_88({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_90 = __VLS_89({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_89));
    let __VLS_92;
    let __VLS_93;
    let __VLS_94;
    const __VLS_95 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_91.slots.default;
    var __VLS_91;
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
        const __VLS_96 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_97 = __VLS_asFunctionalComponent(__VLS_96, new __VLS_96({
            description: "当前没有今日待办",
        }));
        const __VLS_98 = __VLS_97({
            description: "当前没有今日待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_97));
    }
    else {
        const __VLS_100 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_101 = __VLS_asFunctionalComponent(__VLS_100, new __VLS_100({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }));
        const __VLS_102 = __VLS_101({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoTodayTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_101));
        __VLS_103.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_103.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_104 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_105 = __VLS_asFunctionalComponent(__VLS_104, new __VLS_104({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }));
            const __VLS_106 = __VLS_105({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_105));
            __VLS_107.slots.default;
            (__VLS_ctx.taskTypeLabel(data.type));
            var __VLS_107;
            const __VLS_108 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_109 = __VLS_asFunctionalComponent(__VLS_108, new __VLS_108({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }));
            const __VLS_110 = __VLS_109({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_109));
            __VLS_111.slots.default;
            (data.isCompleted ? '已完成' : data.active ? '激活中' : '未激活');
            var __VLS_111;
            const __VLS_112 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_113 = __VLS_asFunctionalComponent(__VLS_112, new __VLS_112({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }));
            const __VLS_114 = __VLS_113({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_113));
            let __VLS_116;
            let __VLS_117;
            let __VLS_118;
            const __VLS_119 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_115.slots.default;
            var __VLS_115;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-meta" },
            });
            if (data.description) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (data.description);
            }
            if (data.startTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.startTime));
            }
            if (data.endTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.endTime));
            }
            if (data.targetDuration) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDuration(data.targetDuration));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_120 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_121 = __VLS_asFunctionalComponent(__VLS_120, new __VLS_120({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }));
            const __VLS_122 = __VLS_121({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_121));
            let __VLS_124;
            let __VLS_125;
            let __VLS_126;
            const __VLS_127 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_123.slots.default;
            (data.isCompleted ? '取消完成' : '完成');
            var __VLS_123;
            const __VLS_128 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_129 = __VLS_asFunctionalComponent(__VLS_128, new __VLS_128({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_130 = __VLS_129({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_129));
            let __VLS_132;
            let __VLS_133;
            let __VLS_134;
            const __VLS_135 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_131.slots.default;
            var __VLS_131;
            const __VLS_136 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_137 = __VLS_asFunctionalComponent(__VLS_136, new __VLS_136({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }));
            const __VLS_138 = __VLS_137({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_137));
            let __VLS_140;
            let __VLS_141;
            let __VLS_142;
            const __VLS_143 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_139.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_139;
            const __VLS_144 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_146 = __VLS_145({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_145));
            let __VLS_148;
            let __VLS_149;
            let __VLS_150;
            const __VLS_151 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoTodayTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_147.slots.default;
            var __VLS_147;
        }
        var __VLS_103;
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
        const __VLS_152 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_153 = __VLS_asFunctionalComponent(__VLS_152, new __VLS_152({
            description: "当前没有后续待办",
        }));
        const __VLS_154 = __VLS_153({
            description: "当前没有后续待办",
        }, ...__VLS_functionalComponentArgsRest(__VLS_153));
    }
    else {
        const __VLS_156 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_157 = __VLS_asFunctionalComponent(__VLS_156, new __VLS_156({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }));
        const __VLS_158 = __VLS_157({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.currentTodoFutureTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_157));
        __VLS_159.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_159.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_160 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_161 = __VLS_asFunctionalComponent(__VLS_160, new __VLS_160({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }));
            const __VLS_162 = __VLS_161({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_161));
            __VLS_163.slots.default;
            (__VLS_ctx.taskTypeLabel(data.type));
            var __VLS_163;
            const __VLS_164 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_165 = __VLS_asFunctionalComponent(__VLS_164, new __VLS_164({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }));
            const __VLS_166 = __VLS_165({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_165));
            __VLS_167.slots.default;
            (data.isCompleted ? '已完成' : data.active ? '激活中' : '未激活');
            var __VLS_167;
            const __VLS_168 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }));
            const __VLS_170 = __VLS_169({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_169));
            let __VLS_172;
            let __VLS_173;
            let __VLS_174;
            const __VLS_175 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openCreateTaskDialog(data);
                }
            };
            __VLS_171.slots.default;
            var __VLS_171;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-meta" },
            });
            if (data.description) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (data.description);
            }
            if (data.startTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.startTime));
            }
            if (data.endTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.endTime));
            }
            if (data.targetDuration) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDuration(data.targetDuration));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_176 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_177 = __VLS_asFunctionalComponent(__VLS_176, new __VLS_176({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }));
            const __VLS_178 = __VLS_177({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_177));
            let __VLS_180;
            let __VLS_181;
            let __VLS_182;
            const __VLS_183 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleComplete(data);
                }
            };
            __VLS_179.slots.default;
            (data.isCompleted ? '取消完成' : '完成');
            var __VLS_179;
            const __VLS_184 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_185 = __VLS_asFunctionalComponent(__VLS_184, new __VLS_184({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_186 = __VLS_185({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_185));
            let __VLS_188;
            let __VLS_189;
            let __VLS_190;
            const __VLS_191 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.openEditTaskDialog(data);
                }
            };
            __VLS_187.slots.default;
            var __VLS_187;
            const __VLS_192 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }));
            const __VLS_194 = __VLS_193({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_193));
            let __VLS_196;
            let __VLS_197;
            let __VLS_198;
            const __VLS_199 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.toggleActive(data);
                }
            };
            __VLS_195.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_195;
            const __VLS_200 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_202 = __VLS_201({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_201));
            let __VLS_204;
            let __VLS_205;
            let __VLS_206;
            const __VLS_207 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSection === 'todo'))
                        return;
                    if (!!(!__VLS_ctx.currentTodoFutureTree.length && !__VLS_ctx.loadingTasks))
                        return;
                    __VLS_ctx.deleteTask(data);
                }
            };
            __VLS_203.slots.default;
            var __VLS_203;
        }
        var __VLS_159;
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
    const __VLS_208 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_209 = __VLS_asFunctionalComponent(__VLS_208, new __VLS_208({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_210 = __VLS_209({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_209));
    let __VLS_212;
    let __VLS_213;
    let __VLS_214;
    const __VLS_215 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateSceneDialog();
        }
    };
    __VLS_211.slots.default;
    var __VLS_211;
    const __VLS_216 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_218 = __VLS_217({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_217));
    let __VLS_220;
    let __VLS_221;
    let __VLS_222;
    const __VLS_223 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_219.slots.default;
    var __VLS_219;
    if (!__VLS_ctx.sceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_224 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_225 = __VLS_asFunctionalComponent(__VLS_224, new __VLS_224({
            description: "当前没有场景",
        }));
        const __VLS_226 = __VLS_225({
            description: "当前没有场景",
        }, ...__VLS_functionalComponentArgsRest(__VLS_225));
    }
    else {
        const __VLS_228 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_229 = __VLS_asFunctionalComponent(__VLS_228, new __VLS_228({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }));
        const __VLS_230 = __VLS_229({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.sceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
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
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_232 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_233 = __VLS_asFunctionalComponent(__VLS_232, new __VLS_232({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }));
            const __VLS_234 = __VLS_233({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_233));
            __VLS_235.slots.default;
            (__VLS_ctx.taskTypeLabel(data.type));
            var __VLS_235;
            const __VLS_236 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_237 = __VLS_asFunctionalComponent(__VLS_236, new __VLS_236({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }));
            const __VLS_238 = __VLS_237({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_237));
            __VLS_239.slots.default;
            (data.isCompleted ? '已完成' : data.active ? '激活中' : '未激活');
            var __VLS_239;
            const __VLS_240 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }));
            const __VLS_242 = __VLS_241({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_241));
            let __VLS_244;
            let __VLS_245;
            let __VLS_246;
            const __VLS_247 = {
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
            __VLS_243.slots.default;
            var __VLS_243;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-meta" },
            });
            if (data.description) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (data.description);
            }
            if (data.startTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.startTime));
            }
            if (data.endTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.endTime));
            }
            if (data.targetDuration) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDuration(data.targetDuration));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_248 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_249 = __VLS_asFunctionalComponent(__VLS_248, new __VLS_248({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }));
            const __VLS_250 = __VLS_249({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_249));
            let __VLS_252;
            let __VLS_253;
            let __VLS_254;
            const __VLS_255 = {
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
            __VLS_251.slots.default;
            (data.isCompleted ? '取消完成' : '完成');
            var __VLS_251;
            const __VLS_256 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_257 = __VLS_asFunctionalComponent(__VLS_256, new __VLS_256({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_258 = __VLS_257({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_257));
            let __VLS_260;
            let __VLS_261;
            let __VLS_262;
            const __VLS_263 = {
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
            __VLS_259.slots.default;
            var __VLS_259;
            const __VLS_264 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_265 = __VLS_asFunctionalComponent(__VLS_264, new __VLS_264({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }));
            const __VLS_266 = __VLS_265({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_265));
            let __VLS_268;
            let __VLS_269;
            let __VLS_270;
            const __VLS_271 = {
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
            __VLS_267.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_267;
            const __VLS_272 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_273 = __VLS_asFunctionalComponent(__VLS_272, new __VLS_272({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_274 = __VLS_273({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_273));
            let __VLS_276;
            let __VLS_277;
            let __VLS_278;
            const __VLS_279 = {
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
            __VLS_275.slots.default;
            var __VLS_275;
        }
        var __VLS_231;
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
    const __VLS_280 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_281 = __VLS_asFunctionalComponent(__VLS_280, new __VLS_280({
        ...{ 'onClick': {} },
        type: "warning",
    }));
    const __VLS_282 = __VLS_281({
        ...{ 'onClick': {} },
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_281));
    let __VLS_284;
    let __VLS_285;
    let __VLS_286;
    const __VLS_287 = {
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.activeSection === 'todo'))
                return;
            if (!(__VLS_ctx.activeSection === 'all'))
                return;
            __VLS_ctx.openCreateTaskDialog(null, false);
        }
    };
    __VLS_283.slots.default;
    var __VLS_283;
    const __VLS_288 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_289 = __VLS_asFunctionalComponent(__VLS_288, new __VLS_288({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }));
    const __VLS_290 = __VLS_289({
        ...{ 'onClick': {} },
        type: "warning",
        plain: true,
        loading: (__VLS_ctx.loadingTasks),
    }, ...__VLS_functionalComponentArgsRest(__VLS_289));
    let __VLS_292;
    let __VLS_293;
    let __VLS_294;
    const __VLS_295 = {
        onClick: (__VLS_ctx.loadTasks)
    };
    __VLS_291.slots.default;
    var __VLS_291;
    if (!__VLS_ctx.nonSceneTaskTree.length && !__VLS_ctx.loadingTasks) {
        const __VLS_296 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_297 = __VLS_asFunctionalComponent(__VLS_296, new __VLS_296({
            description: "当前没有非场景任务",
        }));
        const __VLS_298 = __VLS_297({
            description: "当前没有非场景任务",
        }, ...__VLS_functionalComponentArgsRest(__VLS_297));
    }
    else {
        const __VLS_300 = {}.ElTree;
        /** @type {[typeof __VLS_components.ElTree, typeof __VLS_components.elTree, typeof __VLS_components.ElTree, typeof __VLS_components.elTree, ]} */ ;
        // @ts-ignore
        const __VLS_301 = __VLS_asFunctionalComponent(__VLS_300, new __VLS_300({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }));
        const __VLS_302 = __VLS_301({
            ...{ class: "task-tree" },
            data: (__VLS_ctx.nonSceneTaskTree),
            nodeKey: "taskId",
            props: (__VLS_ctx.treeProps),
            defaultExpandAll: true,
            expandOnClickNode: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_301));
        __VLS_303.slots.default;
        {
            const { default: __VLS_thisSlot } = __VLS_303.slots;
            const [{ data }] = __VLS_getSlotParams(__VLS_thisSlot);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-main" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-title-row" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-node-title" },
            });
            (data.title);
            const __VLS_304 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_305 = __VLS_asFunctionalComponent(__VLS_304, new __VLS_304({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }));
            const __VLS_306 = __VLS_305({
                size: "small",
                type: (__VLS_ctx.taskTypeTagType(data.type)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_305));
            __VLS_307.slots.default;
            (__VLS_ctx.taskTypeLabel(data.type));
            var __VLS_307;
            const __VLS_308 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_309 = __VLS_asFunctionalComponent(__VLS_308, new __VLS_308({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }));
            const __VLS_310 = __VLS_309({
                size: "small",
                type: (data.isCompleted ? 'success' : data.active ? 'warning' : 'info'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_309));
            __VLS_311.slots.default;
            (data.isCompleted ? '已完成' : data.active ? '激活中' : '未激活');
            var __VLS_311;
            const __VLS_312 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_313 = __VLS_asFunctionalComponent(__VLS_312, new __VLS_312({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }));
            const __VLS_314 = __VLS_313({
                ...{ 'onClick': {} },
                link: true,
                type: "primary",
                ...{ class: "task-inline-action" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_313));
            let __VLS_316;
            let __VLS_317;
            let __VLS_318;
            const __VLS_319 = {
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
            __VLS_315.slots.default;
            var __VLS_315;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-meta" },
            });
            if (data.description) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (data.description);
            }
            if (data.startTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.startTime));
            }
            if (data.endTime) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDateTime(data.endTime));
            }
            if (data.targetDuration) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.formatDuration(data.targetDuration));
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "task-node-actions" },
            });
            const __VLS_320 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_321 = __VLS_asFunctionalComponent(__VLS_320, new __VLS_320({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }));
            const __VLS_322 = __VLS_321({
                ...{ 'onClick': {} },
                size: "small",
                type: "success",
            }, ...__VLS_functionalComponentArgsRest(__VLS_321));
            let __VLS_324;
            let __VLS_325;
            let __VLS_326;
            const __VLS_327 = {
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
            __VLS_323.slots.default;
            (data.isCompleted ? '取消完成' : '完成');
            var __VLS_323;
            const __VLS_328 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_329 = __VLS_asFunctionalComponent(__VLS_328, new __VLS_328({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }));
            const __VLS_330 = __VLS_329({
                ...{ 'onClick': {} },
                size: "small",
                type: "primary",
            }, ...__VLS_functionalComponentArgsRest(__VLS_329));
            let __VLS_332;
            let __VLS_333;
            let __VLS_334;
            const __VLS_335 = {
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
            __VLS_331.slots.default;
            var __VLS_331;
            const __VLS_336 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_337 = __VLS_asFunctionalComponent(__VLS_336, new __VLS_336({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }));
            const __VLS_338 = __VLS_337({
                ...{ 'onClick': {} },
                size: "small",
                plain: true,
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_337));
            let __VLS_340;
            let __VLS_341;
            let __VLS_342;
            const __VLS_343 = {
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
            __VLS_339.slots.default;
            (data.active ? '停用' : '启用');
            var __VLS_339;
            const __VLS_344 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_345 = __VLS_asFunctionalComponent(__VLS_344, new __VLS_344({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }));
            const __VLS_346 = __VLS_345({
                ...{ 'onClick': {} },
                size: "small",
                type: "danger",
            }, ...__VLS_functionalComponentArgsRest(__VLS_345));
            let __VLS_348;
            let __VLS_349;
            let __VLS_350;
            const __VLS_351 = {
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
            __VLS_347.slots.default;
            var __VLS_347;
        }
        var __VLS_303;
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
    const __VLS_352 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_353 = __VLS_asFunctionalComponent(__VLS_352, new __VLS_352({
        ...{ 'onClick': {} },
        plain: true,
    }));
    const __VLS_354 = __VLS_353({
        ...{ 'onClick': {} },
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_353));
    let __VLS_356;
    let __VLS_357;
    let __VLS_358;
    const __VLS_359 = {
        onClick: (__VLS_ctx.saveDraft)
    };
    __VLS_355.slots.default;
    var __VLS_355;
    const __VLS_360 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_361 = __VLS_asFunctionalComponent(__VLS_360, new __VLS_360({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }));
    const __VLS_362 = __VLS_361({
        ...{ 'onClick': {} },
        type: "warning",
        loading: (__VLS_ctx.savingReview),
    }, ...__VLS_functionalComponentArgsRest(__VLS_361));
    let __VLS_364;
    let __VLS_365;
    let __VLS_366;
    const __VLS_367 = {
        onClick: (__VLS_ctx.saveReviewToServer)
    };
    __VLS_363.slots.default;
    var __VLS_363;
    const __VLS_368 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_369 = __VLS_asFunctionalComponent(__VLS_368, new __VLS_368({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }));
    const __VLS_370 = __VLS_369({
        modelValue: (__VLS_ctx.reviewDraft),
        type: "textarea",
        rows: (11),
        maxlength: "2000",
        showWordLimit: true,
        placeholder: "写下今天的 review content...",
    }, ...__VLS_functionalComponentArgsRest(__VLS_369));
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
    const __VLS_372 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_373 = __VLS_asFunctionalComponent(__VLS_372, new __VLS_372({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }));
    const __VLS_374 = __VLS_373({
        ...{ 'onClick': {} },
        link: true,
        type: "warning",
    }, ...__VLS_functionalComponentArgsRest(__VLS_373));
    let __VLS_376;
    let __VLS_377;
    let __VLS_378;
    const __VLS_379 = {
        onClick: (__VLS_ctx.loadReviews)
    };
    __VLS_375.slots.default;
    var __VLS_375;
    if (!__VLS_ctx.reviewHistory.length) {
        const __VLS_380 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_381 = __VLS_asFunctionalComponent(__VLS_380, new __VLS_380({
            description: "还没有历史回顾",
        }));
        const __VLS_382 = __VLS_381({
            description: "还没有历史回顾",
        }, ...__VLS_functionalComponentArgsRest(__VLS_381));
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
        const __VLS_384 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_385 = __VLS_asFunctionalComponent(__VLS_384, new __VLS_384({
            type: "warning",
        }));
        const __VLS_386 = __VLS_385({
            type: "warning",
        }, ...__VLS_functionalComponentArgsRest(__VLS_385));
        __VLS_387.slots.default;
        (__VLS_ctx.selectedReview.streakDays ?? 0);
        var __VLS_387;
        const __VLS_388 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_389 = __VLS_asFunctionalComponent(__VLS_388, new __VLS_388({
            type: "info",
        }));
        const __VLS_390 = __VLS_389({
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_389));
        __VLS_391.slots.default;
        (__VLS_ctx.formatDuration(__VLS_ctx.selectedReview.grossEffort));
        var __VLS_391;
    }
    else {
        const __VLS_392 = {}.ElEmpty;
        /** @type {[typeof __VLS_components.ElEmpty, typeof __VLS_components.elEmpty, ]} */ ;
        // @ts-ignore
        const __VLS_393 = __VLS_asFunctionalComponent(__VLS_392, new __VLS_392({
            description: "请选择一条历史 review",
        }));
        const __VLS_394 = __VLS_393({
            description: "请选择一条历史 review",
        }, ...__VLS_functionalComponentArgsRest(__VLS_393));
    }
}
const __VLS_396 = {}.ElDialog;
/** @type {[typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, typeof __VLS_components.ElDialog, typeof __VLS_components.elDialog, ]} */ ;
// @ts-ignore
const __VLS_397 = __VLS_asFunctionalComponent(__VLS_396, new __VLS_396({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: "task-dialog" },
    destroyOnClose: true,
    appendToBody: true,
}));
const __VLS_398 = __VLS_397({
    ...{ 'onClosed': {} },
    modelValue: (__VLS_ctx.taskDialogVisible),
    title: (__VLS_ctx.taskDialogTitle),
    width: "620px",
    ...{ class: "task-dialog" },
    destroyOnClose: true,
    appendToBody: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_397));
let __VLS_400;
let __VLS_401;
let __VLS_402;
const __VLS_403 = {
    onClosed: (__VLS_ctx.resetTaskDialog)
};
__VLS_399.slots.default;
if (!__VLS_ctx.isSceneDialog) {
    const __VLS_404 = {}.ElSteps;
    /** @type {[typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, typeof __VLS_components.ElSteps, typeof __VLS_components.elSteps, ]} */ ;
    // @ts-ignore
    const __VLS_405 = __VLS_asFunctionalComponent(__VLS_404, new __VLS_404({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }));
    const __VLS_406 = __VLS_405({
        active: (__VLS_ctx.taskDialogStep),
        finishStatus: "success",
        alignCenter: true,
        ...{ class: "task-dialog-steps" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_405));
    __VLS_407.slots.default;
    const __VLS_408 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_409 = __VLS_asFunctionalComponent(__VLS_408, new __VLS_408({
        title: "基本信息",
    }));
    const __VLS_410 = __VLS_409({
        title: "基本信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_409));
    const __VLS_412 = {}.ElStep;
    /** @type {[typeof __VLS_components.ElStep, typeof __VLS_components.elStep, ]} */ ;
    // @ts-ignore
    const __VLS_413 = __VLS_asFunctionalComponent(__VLS_412, new __VLS_412({
        title: "时间信息",
    }));
    const __VLS_414 = __VLS_413({
        title: "时间信息",
    }, ...__VLS_functionalComponentArgsRest(__VLS_413));
    var __VLS_407;
}
if (__VLS_ctx.taskDialogParent) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-parent-chip" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.taskDialogParent.title);
    const __VLS_416 = {}.ElTag;
    /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
    // @ts-ignore
    const __VLS_417 = __VLS_asFunctionalComponent(__VLS_416, new __VLS_416({
        size: "small",
        type: (__VLS_ctx.taskTypeTagType(__VLS_ctx.taskDialogParent.type)),
    }));
    const __VLS_418 = __VLS_417({
        size: "small",
        type: (__VLS_ctx.taskTypeTagType(__VLS_ctx.taskDialogParent.type)),
    }, ...__VLS_functionalComponentArgsRest(__VLS_417));
    __VLS_419.slots.default;
    (__VLS_ctx.taskTypeLabel(__VLS_ctx.taskDialogParent.type));
    var __VLS_419;
}
for (const [warning] of __VLS_getVForSourceType((__VLS_ctx.taskDialogWarnings))) {
    const __VLS_420 = {}.ElAlert;
    /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
    // @ts-ignore
    const __VLS_421 = __VLS_asFunctionalComponent(__VLS_420, new __VLS_420({
        key: (warning),
        title: (warning),
        type: "warning",
        showIcon: true,
        closable: (false),
        ...{ class: "task-dialog-alert" },
    }));
    const __VLS_422 = __VLS_421({
        key: (warning),
        title: (warning),
        type: "warning",
        showIcon: true,
        closable: (false),
        ...{ class: "task-dialog-alert" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_421));
}
const __VLS_424 = {}.ElForm;
/** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
// @ts-ignore
const __VLS_425 = __VLS_asFunctionalComponent(__VLS_424, new __VLS_424({
    ...{ 'onSubmit': {} },
    ref: "taskFormRef",
    model: (__VLS_ctx.taskForm),
    rules: (__VLS_ctx.taskFormRules),
    labelPosition: "top",
    ...{ class: "task-dialog-form" },
}));
const __VLS_426 = __VLS_425({
    ...{ 'onSubmit': {} },
    ref: "taskFormRef",
    model: (__VLS_ctx.taskForm),
    rules: (__VLS_ctx.taskFormRules),
    labelPosition: "top",
    ...{ class: "task-dialog-form" },
}, ...__VLS_functionalComponentArgsRest(__VLS_425));
let __VLS_428;
let __VLS_429;
let __VLS_430;
const __VLS_431 = {
    onSubmit: () => { }
};
/** @type {typeof __VLS_ctx.taskFormRef} */ ;
var __VLS_432 = {};
__VLS_427.slots.default;
if (__VLS_ctx.isSceneDialog) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-page" },
    });
    const __VLS_434 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_435 = __VLS_asFunctionalComponent(__VLS_434, new __VLS_434({
        label: "场景标题",
        prop: "title",
    }));
    const __VLS_436 = __VLS_435({
        label: "场景标题",
        prop: "title",
    }, ...__VLS_functionalComponentArgsRest(__VLS_435));
    __VLS_437.slots.default;
    const __VLS_438 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_439 = __VLS_asFunctionalComponent(__VLS_438, new __VLS_438({
        modelValue: (__VLS_ctx.taskForm.title),
        placeholder: "请输入场景标题",
        maxlength: "120",
        showWordLimit: true,
    }));
    const __VLS_440 = __VLS_439({
        modelValue: (__VLS_ctx.taskForm.title),
        placeholder: "请输入场景标题",
        maxlength: "120",
        showWordLimit: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_439));
    var __VLS_437;
    const __VLS_442 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_443 = __VLS_asFunctionalComponent(__VLS_442, new __VLS_442({
        label: "场景描述（可选）",
        prop: "description",
    }));
    const __VLS_444 = __VLS_443({
        label: "场景描述（可选）",
        prop: "description",
    }, ...__VLS_functionalComponentArgsRest(__VLS_443));
    __VLS_445.slots.default;
    const __VLS_446 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_447 = __VLS_asFunctionalComponent(__VLS_446, new __VLS_446({
        modelValue: (__VLS_ctx.taskForm.description),
        type: "textarea",
        rows: (5),
        maxlength: "500",
        showWordLimit: true,
        placeholder: "补充场景说明",
    }));
    const __VLS_448 = __VLS_447({
        modelValue: (__VLS_ctx.taskForm.description),
        type: "textarea",
        rows: (5),
        maxlength: "500",
        showWordLimit: true,
        placeholder: "补充场景说明",
    }, ...__VLS_functionalComponentArgsRest(__VLS_447));
    var __VLS_445;
    const __VLS_450 = {}.ElAlert;
    /** @type {[typeof __VLS_components.ElAlert, typeof __VLS_components.elAlert, ]} */ ;
    // @ts-ignore
    const __VLS_451 = __VLS_asFunctionalComponent(__VLS_450, new __VLS_450({
        title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
        type: "info",
        showIcon: true,
        closable: (false),
        ...{ class: "task-dialog-alert" },
    }));
    const __VLS_452 = __VLS_451({
        title: "场景不包含时间信息，保存后可在全部任务中继续添加场景内任务。",
        type: "info",
        showIcon: true,
        closable: (false),
        ...{ class: "task-dialog-alert" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_451));
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-page" },
    });
    __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.taskDialogStep === 0) }, null, null);
    const __VLS_454 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_455 = __VLS_asFunctionalComponent(__VLS_454, new __VLS_454({
        label: "标题",
        prop: "title",
    }));
    const __VLS_456 = __VLS_455({
        label: "标题",
        prop: "title",
    }, ...__VLS_functionalComponentArgsRest(__VLS_455));
    __VLS_457.slots.default;
    const __VLS_458 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_459 = __VLS_asFunctionalComponent(__VLS_458, new __VLS_458({
        modelValue: (__VLS_ctx.taskForm.title),
        placeholder: "请输入任务标题",
        maxlength: "120",
        showWordLimit: true,
    }));
    const __VLS_460 = __VLS_459({
        modelValue: (__VLS_ctx.taskForm.title),
        placeholder: "请输入任务标题",
        maxlength: "120",
        showWordLimit: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_459));
    var __VLS_457;
    const __VLS_462 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_463 = __VLS_asFunctionalComponent(__VLS_462, new __VLS_462({
        label: "描述（可选）",
        prop: "description",
    }));
    const __VLS_464 = __VLS_463({
        label: "描述（可选）",
        prop: "description",
    }, ...__VLS_functionalComponentArgsRest(__VLS_463));
    __VLS_465.slots.default;
    const __VLS_466 = {}.ElInput;
    /** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
    // @ts-ignore
    const __VLS_467 = __VLS_asFunctionalComponent(__VLS_466, new __VLS_466({
        modelValue: (__VLS_ctx.taskForm.description),
        type: "textarea",
        rows: (4),
        maxlength: "500",
        showWordLimit: true,
        placeholder: "补充任务说明",
    }));
    const __VLS_468 = __VLS_467({
        modelValue: (__VLS_ctx.taskForm.description),
        type: "textarea",
        rows: (4),
        maxlength: "500",
        showWordLimit: true,
        placeholder: "补充任务说明",
    }, ...__VLS_functionalComponentArgsRest(__VLS_467));
    var __VLS_465;
    const __VLS_470 = {}.ElRow;
    /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
    // @ts-ignore
    const __VLS_471 = __VLS_asFunctionalComponent(__VLS_470, new __VLS_470({
        gutter: (14),
    }));
    const __VLS_472 = __VLS_471({
        gutter: (14),
    }, ...__VLS_functionalComponentArgsRest(__VLS_471));
    __VLS_473.slots.default;
    const __VLS_474 = {}.ElCol;
    /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
    // @ts-ignore
    const __VLS_475 = __VLS_asFunctionalComponent(__VLS_474, new __VLS_474({
        xs: (24),
        sm: (12),
    }));
    const __VLS_476 = __VLS_475({
        xs: (24),
        sm: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_475));
    __VLS_477.slots.default;
    const __VLS_478 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_479 = __VLS_asFunctionalComponent(__VLS_478, new __VLS_478({
        label: "类型",
        prop: "type",
    }));
    const __VLS_480 = __VLS_479({
        label: "类型",
        prop: "type",
    }, ...__VLS_functionalComponentArgsRest(__VLS_479));
    __VLS_481.slots.default;
    if (__VLS_ctx.taskForm.type !== 3) {
        const __VLS_482 = {}.ElSelect;
        /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
        // @ts-ignore
        const __VLS_483 = __VLS_asFunctionalComponent(__VLS_482, new __VLS_482({
            modelValue: (__VLS_ctx.taskForm.type),
            ...{ class: "w-full" },
        }));
        const __VLS_484 = __VLS_483({
            modelValue: (__VLS_ctx.taskForm.type),
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_483));
        __VLS_485.slots.default;
        for (const [option] of __VLS_getVForSourceType((__VLS_ctx.taskTypeOptions))) {
            const __VLS_486 = {}.ElOption;
            /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
            // @ts-ignore
            const __VLS_487 = __VLS_asFunctionalComponent(__VLS_486, new __VLS_486({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }));
            const __VLS_488 = __VLS_487({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }, ...__VLS_functionalComponentArgsRest(__VLS_487));
        }
        var __VLS_485;
    }
    else {
        const __VLS_490 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_491 = __VLS_asFunctionalComponent(__VLS_490, new __VLS_490({
            type: "warning",
        }));
        const __VLS_492 = __VLS_491({
            type: "warning",
        }, ...__VLS_functionalComponentArgsRest(__VLS_491));
        __VLS_493.slots.default;
        var __VLS_493;
    }
    var __VLS_481;
    var __VLS_477;
    var __VLS_473;
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
        const __VLS_494 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_495 = __VLS_asFunctionalComponent(__VLS_494, new __VLS_494({
            gutter: (14),
            ...{ class: "task-recurrence-row" },
        }));
        const __VLS_496 = __VLS_495({
            gutter: (14),
            ...{ class: "task-recurrence-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_495));
        __VLS_497.slots.default;
        const __VLS_498 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_499 = __VLS_asFunctionalComponent(__VLS_498, new __VLS_498({
            xs: (24),
            sm: (10),
        }));
        const __VLS_500 = __VLS_499({
            xs: (24),
            sm: (10),
        }, ...__VLS_functionalComponentArgsRest(__VLS_499));
        __VLS_501.slots.default;
        const __VLS_502 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_503 = __VLS_asFunctionalComponent(__VLS_502, new __VLS_502({
            label: "循环尺度",
            prop: "cycleMode",
        }));
        const __VLS_504 = __VLS_503({
            label: "循环尺度",
            prop: "cycleMode",
        }, ...__VLS_functionalComponentArgsRest(__VLS_503));
        __VLS_505.slots.default;
        const __VLS_506 = {}.ElSelect;
        /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
        // @ts-ignore
        const __VLS_507 = __VLS_asFunctionalComponent(__VLS_506, new __VLS_506({
            modelValue: (__VLS_ctx.taskForm.cycleMode),
            ...{ class: "w-full" },
        }));
        const __VLS_508 = __VLS_507({
            modelValue: (__VLS_ctx.taskForm.cycleMode),
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_507));
        __VLS_509.slots.default;
        for (const [option] of __VLS_getVForSourceType((__VLS_ctx.cycleModeOptions))) {
            const __VLS_510 = {}.ElOption;
            /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
            // @ts-ignore
            const __VLS_511 = __VLS_asFunctionalComponent(__VLS_510, new __VLS_510({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }));
            const __VLS_512 = __VLS_511({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }, ...__VLS_functionalComponentArgsRest(__VLS_511));
        }
        var __VLS_509;
        var __VLS_505;
        var __VLS_501;
        const __VLS_514 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_515 = __VLS_asFunctionalComponent(__VLS_514, new __VLS_514({
            xs: (24),
            sm: (14),
        }));
        const __VLS_516 = __VLS_515({
            xs: (24),
            sm: (14),
        }, ...__VLS_functionalComponentArgsRest(__VLS_515));
        __VLS_517.slots.default;
        if (__VLS_ctx.taskForm.cycleMode === 'interval') {
            const __VLS_518 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_519 = __VLS_asFunctionalComponent(__VLS_518, new __VLS_518({
                label: "具体选择",
                prop: "cycleIntervalDays",
            }));
            const __VLS_520 = __VLS_519({
                label: "具体选择",
                prop: "cycleIntervalDays",
            }, ...__VLS_functionalComponentArgsRest(__VLS_519));
            __VLS_521.slots.default;
            const __VLS_522 = {}.ElInputNumber;
            /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
            // @ts-ignore
            const __VLS_523 = __VLS_asFunctionalComponent(__VLS_522, new __VLS_522({
                modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                min: (1),
                step: (1),
                controlsPosition: "right",
                ...{ class: "w-full" },
            }));
            const __VLS_524 = __VLS_523({
                modelValue: (__VLS_ctx.taskForm.cycleIntervalDays),
                min: (1),
                step: (1),
                controlsPosition: "right",
                ...{ class: "w-full" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_523));
            var __VLS_521;
        }
        else if (__VLS_ctx.taskForm.cycleMode === 'weekly') {
            const __VLS_526 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_527 = __VLS_asFunctionalComponent(__VLS_526, new __VLS_526({
                label: "具体选择",
                prop: "cycleWeekdays",
            }));
            const __VLS_528 = __VLS_527({
                label: "具体选择",
                prop: "cycleWeekdays",
            }, ...__VLS_functionalComponentArgsRest(__VLS_527));
            __VLS_529.slots.default;
            const __VLS_530 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_531 = __VLS_asFunctionalComponent(__VLS_530, new __VLS_530({
                modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                multiple: true,
                collapseTags: true,
                collapseTagsTooltip: true,
                ...{ class: "w-full" },
                placeholder: "选择一个或多个星期",
            }));
            const __VLS_532 = __VLS_531({
                modelValue: (__VLS_ctx.taskForm.cycleWeekdays),
                multiple: true,
                collapseTags: true,
                collapseTagsTooltip: true,
                ...{ class: "w-full" },
                placeholder: "选择一个或多个星期",
            }, ...__VLS_functionalComponentArgsRest(__VLS_531));
            __VLS_533.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.weekdayOptions))) {
                const __VLS_534 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_535 = __VLS_asFunctionalComponent(__VLS_534, new __VLS_534({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_536 = __VLS_535({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_535));
            }
            var __VLS_533;
            var __VLS_529;
        }
        else if (__VLS_ctx.taskForm.cycleMode === 'monthly') {
            const __VLS_538 = {}.ElFormItem;
            /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
            // @ts-ignore
            const __VLS_539 = __VLS_asFunctionalComponent(__VLS_538, new __VLS_538({
                label: "具体选择",
                prop: "cycleMonthDays",
            }));
            const __VLS_540 = __VLS_539({
                label: "具体选择",
                prop: "cycleMonthDays",
            }, ...__VLS_functionalComponentArgsRest(__VLS_539));
            __VLS_541.slots.default;
            const __VLS_542 = {}.ElSelect;
            /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
            // @ts-ignore
            const __VLS_543 = __VLS_asFunctionalComponent(__VLS_542, new __VLS_542({
                modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                multiple: true,
                collapseTags: true,
                collapseTagsTooltip: true,
                ...{ class: "w-full" },
                placeholder: "选择一个或多个日期",
            }));
            const __VLS_544 = __VLS_543({
                modelValue: (__VLS_ctx.taskForm.cycleMonthDays),
                multiple: true,
                collapseTags: true,
                collapseTagsTooltip: true,
                ...{ class: "w-full" },
                placeholder: "选择一个或多个日期",
            }, ...__VLS_functionalComponentArgsRest(__VLS_543));
            __VLS_545.slots.default;
            for (const [option] of __VLS_getVForSourceType((__VLS_ctx.monthDayOptions))) {
                const __VLS_546 = {}.ElOption;
                /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
                // @ts-ignore
                const __VLS_547 = __VLS_asFunctionalComponent(__VLS_546, new __VLS_546({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }));
                const __VLS_548 = __VLS_547({
                    key: (option.value),
                    label: (option.label),
                    value: (option.value),
                }, ...__VLS_functionalComponentArgsRest(__VLS_547));
            }
            var __VLS_545;
            var __VLS_541;
        }
        var __VLS_517;
        var __VLS_497;
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
    const __VLS_550 = {}.ElRow;
    /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
    // @ts-ignore
    const __VLS_551 = __VLS_asFunctionalComponent(__VLS_550, new __VLS_550({
        gutter: (14),
        ...{ class: "task-duration-row" },
    }));
    const __VLS_552 = __VLS_551({
        gutter: (14),
        ...{ class: "task-duration-row" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_551));
    __VLS_553.slots.default;
    const __VLS_554 = {}.ElCol;
    /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
    // @ts-ignore
    const __VLS_555 = __VLS_asFunctionalComponent(__VLS_554, new __VLS_554({
        xs: (24),
        sm: (12),
    }));
    const __VLS_556 = __VLS_555({
        xs: (24),
        sm: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_555));
    __VLS_557.slots.default;
    const __VLS_558 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_559 = __VLS_asFunctionalComponent(__VLS_558, new __VLS_558({
        label: "小时",
        prop: "planDurationHours",
    }));
    const __VLS_560 = __VLS_559({
        label: "小时",
        prop: "planDurationHours",
    }, ...__VLS_functionalComponentArgsRest(__VLS_559));
    __VLS_561.slots.default;
    const __VLS_562 = {}.ElInputNumber;
    /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
    // @ts-ignore
    const __VLS_563 = __VLS_asFunctionalComponent(__VLS_562, new __VLS_562({
        modelValue: (__VLS_ctx.taskForm.planDurationHours),
        min: (0),
        step: (1),
        controlsPosition: "right",
        ...{ class: "w-full" },
    }));
    const __VLS_564 = __VLS_563({
        modelValue: (__VLS_ctx.taskForm.planDurationHours),
        min: (0),
        step: (1),
        controlsPosition: "right",
        ...{ class: "w-full" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_563));
    var __VLS_561;
    var __VLS_557;
    const __VLS_566 = {}.ElCol;
    /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
    // @ts-ignore
    const __VLS_567 = __VLS_asFunctionalComponent(__VLS_566, new __VLS_566({
        xs: (24),
        sm: (12),
    }));
    const __VLS_568 = __VLS_567({
        xs: (24),
        sm: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_567));
    __VLS_569.slots.default;
    const __VLS_570 = {}.ElFormItem;
    /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_571 = __VLS_asFunctionalComponent(__VLS_570, new __VLS_570({
        label: "分钟",
        prop: "planDurationMinutes",
    }));
    const __VLS_572 = __VLS_571({
        label: "分钟",
        prop: "planDurationMinutes",
    }, ...__VLS_functionalComponentArgsRest(__VLS_571));
    __VLS_573.slots.default;
    const __VLS_574 = {}.ElInputNumber;
    /** @type {[typeof __VLS_components.ElInputNumber, typeof __VLS_components.elInputNumber, ]} */ ;
    // @ts-ignore
    const __VLS_575 = __VLS_asFunctionalComponent(__VLS_574, new __VLS_574({
        modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
        min: (0),
        max: (59),
        step: (1),
        controlsPosition: "right",
        ...{ class: "w-full" },
    }));
    const __VLS_576 = __VLS_575({
        modelValue: (__VLS_ctx.taskForm.planDurationMinutes),
        min: (0),
        max: (59),
        step: (1),
        controlsPosition: "right",
        ...{ class: "w-full" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_575));
    var __VLS_573;
    var __VLS_569;
    var __VLS_553;
    if (__VLS_ctx.isRecurringTask) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-title" },
        });
        const __VLS_578 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_579 = __VLS_asFunctionalComponent(__VLS_578, new __VLS_578({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }));
        const __VLS_580 = __VLS_579({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_579));
        __VLS_581.slots.default;
        const __VLS_582 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_583 = __VLS_asFunctionalComponent(__VLS_582, new __VLS_582({
            xs: (24),
            sm: (12),
        }));
        const __VLS_584 = __VLS_583({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_583));
        __VLS_585.slots.default;
        const __VLS_586 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_587 = __VLS_asFunctionalComponent(__VLS_586, new __VLS_586({
            label: "开始时分",
        }));
        const __VLS_588 = __VLS_587({
            label: "开始时分",
        }, ...__VLS_functionalComponentArgsRest(__VLS_587));
        __VLS_589.slots.default;
        const __VLS_590 = {}.ElTimePicker;
        /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
        // @ts-ignore
        const __VLS_591 = __VLS_asFunctionalComponent(__VLS_590, new __VLS_590({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }));
        const __VLS_592 = __VLS_591({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_591));
        let __VLS_594;
        let __VLS_595;
        let __VLS_596;
        const __VLS_597 = {
            'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
        };
        var __VLS_593;
        var __VLS_589;
        var __VLS_585;
        const __VLS_598 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_599 = __VLS_asFunctionalComponent(__VLS_598, new __VLS_598({
            xs: (24),
            sm: (12),
        }));
        const __VLS_600 = __VLS_599({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_599));
        __VLS_601.slots.default;
        const __VLS_602 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_603 = __VLS_asFunctionalComponent(__VLS_602, new __VLS_602({
            label: "结束时分",
        }));
        const __VLS_604 = __VLS_603({
            label: "结束时分",
        }, ...__VLS_functionalComponentArgsRest(__VLS_603));
        __VLS_605.slots.default;
        const __VLS_606 = {}.ElTimePicker;
        /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
        // @ts-ignore
        const __VLS_607 = __VLS_asFunctionalComponent(__VLS_606, new __VLS_606({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }));
        const __VLS_608 = __VLS_607({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_607));
        let __VLS_610;
        let __VLS_611;
        let __VLS_612;
        const __VLS_613 = {
            'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
        };
        var __VLS_609;
        var __VLS_605;
        var __VLS_601;
        var __VLS_581;
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-block" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "task-dialog-section-title" },
        });
        const __VLS_614 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_615 = __VLS_asFunctionalComponent(__VLS_614, new __VLS_614({
            label: "开始时间",
            prop: "startTime",
        }));
        const __VLS_616 = __VLS_615({
            label: "开始时间",
            prop: "startTime",
        }, ...__VLS_functionalComponentArgsRest(__VLS_615));
        __VLS_617.slots.default;
        const __VLS_618 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_619 = __VLS_asFunctionalComponent(__VLS_618, new __VLS_618({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }));
        const __VLS_620 = __VLS_619({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_619));
        __VLS_621.slots.default;
        const __VLS_622 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_623 = __VLS_asFunctionalComponent(__VLS_622, new __VLS_622({
            xs: (24),
            sm: (12),
        }));
        const __VLS_624 = __VLS_623({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_623));
        __VLS_625.slots.default;
        const __VLS_626 = {}.ElDatePicker;
        /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
        // @ts-ignore
        const __VLS_627 = __VLS_asFunctionalComponent(__VLS_626, new __VLS_626({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
            type: "date",
            format: "YYYY-MM-DD",
            valueFormat: "YYYY-MM-DD",
            placeholder: "选择日期",
            ...{ class: "w-full" },
        }));
        const __VLS_628 = __VLS_627({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.startTime)),
            type: "date",
            format: "YYYY-MM-DD",
            valueFormat: "YYYY-MM-DD",
            placeholder: "选择日期",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_627));
        let __VLS_630;
        let __VLS_631;
        let __VLS_632;
        const __VLS_633 = {
            'onUpdate:modelValue': (__VLS_ctx.updateStartDatePart)
        };
        var __VLS_629;
        var __VLS_625;
        const __VLS_634 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_635 = __VLS_asFunctionalComponent(__VLS_634, new __VLS_634({
            xs: (24),
            sm: (12),
        }));
        const __VLS_636 = __VLS_635({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_635));
        __VLS_637.slots.default;
        const __VLS_638 = {}.ElTimePicker;
        /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
        // @ts-ignore
        const __VLS_639 = __VLS_asFunctionalComponent(__VLS_638, new __VLS_638({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }));
        const __VLS_640 = __VLS_639({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.startTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_639));
        let __VLS_642;
        let __VLS_643;
        let __VLS_644;
        const __VLS_645 = {
            'onUpdate:modelValue': (__VLS_ctx.updateStartTimePart)
        };
        var __VLS_641;
        var __VLS_637;
        var __VLS_621;
        var __VLS_617;
        const __VLS_646 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_647 = __VLS_asFunctionalComponent(__VLS_646, new __VLS_646({
            label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
            prop: "endTime",
        }));
        const __VLS_648 = __VLS_647({
            label: (String(__VLS_ctx.taskForm.type) === '2' ? '完成时间' : '结束时间'),
            prop: "endTime",
        }, ...__VLS_functionalComponentArgsRest(__VLS_647));
        __VLS_649.slots.default;
        const __VLS_650 = {}.ElRow;
        /** @type {[typeof __VLS_components.ElRow, typeof __VLS_components.elRow, typeof __VLS_components.ElRow, typeof __VLS_components.elRow, ]} */ ;
        // @ts-ignore
        const __VLS_651 = __VLS_asFunctionalComponent(__VLS_650, new __VLS_650({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }));
        const __VLS_652 = __VLS_651({
            gutter: (10),
            ...{ class: "task-datetime-row" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_651));
        __VLS_653.slots.default;
        const __VLS_654 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_655 = __VLS_asFunctionalComponent(__VLS_654, new __VLS_654({
            xs: (24),
            sm: (12),
        }));
        const __VLS_656 = __VLS_655({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_655));
        __VLS_657.slots.default;
        const __VLS_658 = {}.ElDatePicker;
        /** @type {[typeof __VLS_components.ElDatePicker, typeof __VLS_components.elDatePicker, ]} */ ;
        // @ts-ignore
        const __VLS_659 = __VLS_asFunctionalComponent(__VLS_658, new __VLS_658({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
            type: "date",
            format: "YYYY-MM-DD",
            valueFormat: "YYYY-MM-DD",
            placeholder: "选择日期",
            ...{ class: "w-full" },
        }));
        const __VLS_660 = __VLS_659({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getDatePart(__VLS_ctx.taskForm.endTime)),
            type: "date",
            format: "YYYY-MM-DD",
            valueFormat: "YYYY-MM-DD",
            placeholder: "选择日期",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_659));
        let __VLS_662;
        let __VLS_663;
        let __VLS_664;
        const __VLS_665 = {
            'onUpdate:modelValue': (__VLS_ctx.updateEndDatePart)
        };
        var __VLS_661;
        var __VLS_657;
        const __VLS_666 = {}.ElCol;
        /** @type {[typeof __VLS_components.ElCol, typeof __VLS_components.elCol, typeof __VLS_components.ElCol, typeof __VLS_components.elCol, ]} */ ;
        // @ts-ignore
        const __VLS_667 = __VLS_asFunctionalComponent(__VLS_666, new __VLS_666({
            xs: (24),
            sm: (12),
        }));
        const __VLS_668 = __VLS_667({
            xs: (24),
            sm: (12),
        }, ...__VLS_functionalComponentArgsRest(__VLS_667));
        __VLS_669.slots.default;
        const __VLS_670 = {}.ElTimePicker;
        /** @type {[typeof __VLS_components.ElTimePicker, typeof __VLS_components.elTimePicker, ]} */ ;
        // @ts-ignore
        const __VLS_671 = __VLS_asFunctionalComponent(__VLS_670, new __VLS_670({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }));
        const __VLS_672 = __VLS_671({
            ...{ 'onUpdate:modelValue': {} },
            modelValue: (__VLS_ctx.getTimePart(__VLS_ctx.taskForm.endTime)),
            format: "HH:mm",
            valueFormat: "HH:mm:ss",
            placeholder: "选择时分",
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_671));
        let __VLS_674;
        let __VLS_675;
        let __VLS_676;
        const __VLS_677 = {
            'onUpdate:modelValue': (__VLS_ctx.updateEndTimePart)
        };
        var __VLS_673;
        var __VLS_669;
        var __VLS_653;
        var __VLS_649;
    }
    if (String(__VLS_ctx.taskForm.type) !== '0') {
        const __VLS_678 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_679 = __VLS_asFunctionalComponent(__VLS_678, new __VLS_678({
            prop: "settlementType",
        }));
        const __VLS_680 = __VLS_679({
            prop: "settlementType",
        }, ...__VLS_functionalComponentArgsRest(__VLS_679));
        __VLS_681.slots.default;
        {
            const { label: __VLS_thisSlot } = __VLS_681.slots;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-settlement-label" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
            const __VLS_682 = {}.ElTooltip;
            /** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
            // @ts-ignore
            const __VLS_683 = __VLS_asFunctionalComponent(__VLS_682, new __VLS_682({
                effect: "dark",
                placement: "top",
                rawContent: true,
                content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
            }));
            const __VLS_684 = __VLS_683({
                effect: "dark",
                placement: "top",
                rawContent: true,
                content: "自动结算：累计用时达到计划时，自动标记为完成；<br />手动结算：需要用户点击‘完成’按钮才会标记为完成",
            }, ...__VLS_functionalComponentArgsRest(__VLS_683));
            __VLS_685.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "task-settlement-help" },
                'aria-label': "结算模式说明",
            });
            var __VLS_685;
        }
        const __VLS_686 = {}.ElSelect;
        /** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
        // @ts-ignore
        const __VLS_687 = __VLS_asFunctionalComponent(__VLS_686, new __VLS_686({
            modelValue: (__VLS_ctx.taskForm.settlementType),
            ...{ class: "w-full" },
        }));
        const __VLS_688 = __VLS_687({
            modelValue: (__VLS_ctx.taskForm.settlementType),
            ...{ class: "w-full" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_687));
        __VLS_689.slots.default;
        for (const [option] of __VLS_getVForSourceType((__VLS_ctx.settlementTypeOptions))) {
            const __VLS_690 = {}.ElOption;
            /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
            // @ts-ignore
            const __VLS_691 = __VLS_asFunctionalComponent(__VLS_690, new __VLS_690({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }));
            const __VLS_692 = __VLS_691({
                key: (option.value),
                label: (option.label),
                value: (option.value),
            }, ...__VLS_functionalComponentArgsRest(__VLS_691));
        }
        var __VLS_689;
        var __VLS_681;
    }
    if (__VLS_ctx.taskDialogParent) {
        const __VLS_694 = {}.ElFormItem;
        /** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_695 = __VLS_asFunctionalComponent(__VLS_694, new __VLS_694({
            label: "是否同步时长到父任务",
            prop: "inheritParentTime",
        }));
        const __VLS_696 = __VLS_695({
            label: "是否同步时长到父任务",
            prop: "inheritParentTime",
        }, ...__VLS_functionalComponentArgsRest(__VLS_695));
        __VLS_697.slots.default;
        const __VLS_698 = {}.ElSwitch;
        /** @type {[typeof __VLS_components.ElSwitch, typeof __VLS_components.elSwitch, ]} */ ;
        // @ts-ignore
        const __VLS_699 = __VLS_asFunctionalComponent(__VLS_698, new __VLS_698({
            modelValue: (__VLS_ctx.taskForm.inheritParentTime),
            activeText: "同步",
            inactiveText: "不计入",
        }));
        const __VLS_700 = __VLS_699({
            modelValue: (__VLS_ctx.taskForm.inheritParentTime),
            activeText: "同步",
            inactiveText: "不计入",
        }, ...__VLS_functionalComponentArgsRest(__VLS_699));
        var __VLS_697;
    }
}
var __VLS_427;
{
    const { footer: __VLS_thisSlot } = __VLS_399.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "task-dialog-footer" },
    });
    const __VLS_702 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_703 = __VLS_asFunctionalComponent(__VLS_702, new __VLS_702({
        ...{ 'onClick': {} },
    }));
    const __VLS_704 = __VLS_703({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_703));
    let __VLS_706;
    let __VLS_707;
    let __VLS_708;
    const __VLS_709 = {
        onClick: (...[$event]) => {
            __VLS_ctx.taskDialogVisible = false;
        }
    };
    __VLS_705.slots.default;
    var __VLS_705;
    if (__VLS_ctx.isSceneDialog) {
        const __VLS_710 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_711 = __VLS_asFunctionalComponent(__VLS_710, new __VLS_710({
            ...{ 'onClick': {} },
            type: "warning",
            loading: (__VLS_ctx.taskDialogLoading),
        }));
        const __VLS_712 = __VLS_711({
            ...{ 'onClick': {} },
            type: "warning",
            loading: (__VLS_ctx.taskDialogLoading),
        }, ...__VLS_functionalComponentArgsRest(__VLS_711));
        let __VLS_714;
        let __VLS_715;
        let __VLS_716;
        const __VLS_717 = {
            onClick: (__VLS_ctx.submitTaskDialog)
        };
        __VLS_713.slots.default;
        var __VLS_713;
    }
    else {
        if (__VLS_ctx.taskDialogStep > 0) {
            const __VLS_718 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_719 = __VLS_asFunctionalComponent(__VLS_718, new __VLS_718({
                ...{ 'onClick': {} },
            }));
            const __VLS_720 = __VLS_719({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_719));
            let __VLS_722;
            let __VLS_723;
            let __VLS_724;
            const __VLS_725 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.isSceneDialog))
                        return;
                    if (!(__VLS_ctx.taskDialogStep > 0))
                        return;
                    __VLS_ctx.taskDialogStep -= 1;
                }
            };
            __VLS_721.slots.default;
            var __VLS_721;
        }
        if (__VLS_ctx.taskDialogStep === 0) {
            const __VLS_726 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_727 = __VLS_asFunctionalComponent(__VLS_726, new __VLS_726({
                ...{ 'onClick': {} },
                type: "warning",
            }));
            const __VLS_728 = __VLS_727({
                ...{ 'onClick': {} },
                type: "warning",
            }, ...__VLS_functionalComponentArgsRest(__VLS_727));
            let __VLS_730;
            let __VLS_731;
            let __VLS_732;
            const __VLS_733 = {
                onClick: (__VLS_ctx.goTaskDialogNext)
            };
            __VLS_729.slots.default;
            var __VLS_729;
        }
        else {
            const __VLS_734 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_735 = __VLS_asFunctionalComponent(__VLS_734, new __VLS_734({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }));
            const __VLS_736 = __VLS_735({
                ...{ 'onClick': {} },
                type: "warning",
                loading: (__VLS_ctx.taskDialogLoading),
            }, ...__VLS_functionalComponentArgsRest(__VLS_735));
            let __VLS_738;
            let __VLS_739;
            let __VLS_740;
            const __VLS_741 = {
                onClick: (__VLS_ctx.submitTaskDialog)
            };
            __VLS_737.slots.default;
            var __VLS_737;
        }
    }
}
var __VLS_399;
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-inline-action']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-inline-action']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-inline-action']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-inline-action']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-node-title']} */ ;
/** @type {__VLS_StyleScopedClasses['task-inline-action']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['task-node-actions']} */ ;
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
/** @type {__VLS_StyleScopedClasses['task-dialog']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-steps']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-parent-chip']} */ ;
/** @type {__VLS_StyleScopedClasses['task-dialog-alert']} */ ;
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
var __VLS_433 = __VLS_432;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            activeSection: activeSection,
            loadingTasks: loadingTasks,
            savingReview: savingReview,
            taskDialogVisible: taskDialogVisible,
            taskDialogStep: taskDialogStep,
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
            taskTypeLabel: taskTypeLabel,
            taskTypeTagType: taskTypeTagType,
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
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
