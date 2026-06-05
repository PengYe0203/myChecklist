import http, { ApiResult } from './http';

export interface TaskLogItem {
  logId: number;
  taskId: number;
  userId: number;
  date: string;
  title: string;
  type: number;
  plannedDuration: number;
  parentId: number | null;
  actualDuration: number;
  dailyActualDuration: number;
  resultStatus: number;
  workSegments: string;
}

/** 按日期获取当前用户的 TaskLog 列表 */
export const getTaskLogsByDateApi = (date: string) => {
  return http.get('/task-logs', { params: { date } }) as Promise<ApiResult<TaskLogItem[]>>;
};

/** 获取单条 TaskLog 详情 */
export const getTaskLogByIdApi = (logId: number) => {
  return http.get(`/task-logs/${logId}`) as Promise<ApiResult<TaskLogItem>>;
};
