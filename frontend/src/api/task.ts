import http, { ApiResult } from './http';

export interface TaskItem {
  taskId: number;
  userId?: number;
  parentId?: number | null;
  title: string;
  description?: string;
  createTime?: string;
  type?: string;
  settlementType?: string;
  targetDuration?: number;
  startTime?: string;
  endTime?: string;
  cronConfig?: string;
  inheritParentTime?: boolean;
  isCompleted?: boolean;
  actualDuration?: number;
  ownDuration?: number;
  subDurationSum?: number;
  runStatus?: string;
  lastStartTime?: string;
  currentDaySegments?: string;
  active?: boolean;
  children?: TaskItem[];
}

export const getAllTasksApi = () => {
  return http.get('/tasks/getAllTasks') as Promise<ApiResult<TaskItem[]>>;
};

export const createTaskApi = (task: Record<string, unknown>) => {
  return http.post('/tasks/createTask', task) as Promise<ApiResult<string>>;
};

export const updateTaskApi = (task: Record<string, unknown>) => {
  return http.post('/tasks/updateTask', task) as Promise<ApiResult<string>>;
};

export const deleteTaskApi = (id: number) => {
  return http.post(`/tasks/delete/${id}`) as Promise<ApiResult<string>>;
};

export const resetTaskApi = (id: number) => {
  return http.post(`/tasks/reset/${id}`) as Promise<ApiResult<string>>;
};

export const toggleActiveApi = (id: number, active: boolean) => {
  return http.post(`/tasks/toggleActive/${id}`, null, { params: { active } }) as Promise<ApiResult<string>>;
};

export const toggleCompleteApi = (id: number, complete: boolean) => {
  return http.post(`/tasks/toggleComplete/${id}`, null, { params: { complete } }) as Promise<ApiResult<string>>;
};

export const heartbeatApi = (id: number) => {
  return http.post(`/tasks/heartbeat/${id}`) as Promise<ApiResult<string>>;
};