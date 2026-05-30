import http, { ApiResult } from './http';

export interface ReviewItem {
  reviewId: number;
  userId?: number;
  date: string;
  content?: string;
  doneCount?: number;
  totalCount?: number;
  actualDurationSum?: number;
  plannedDurationSum?: number;
  grossEffort?: number;
  netFocusTime?: number;
  timeDistribution?: string;
  streakDays?: number;
}

export interface ReviewAggregateVo {
  reviewCount?: number;
  doneCount?: number;
  totalCount?: number;
  actualDurationSum?: number;
  plannedDurationSum?: number;
  grossEffort?: number;
  netFocusTime?: number;
  activeDistribution?: string[];
  streakDistribution?: string[];
}

export const getReviewByDateApi = (date: string) => {
  return http.get('/reviews', { params: { date } }) as Promise<ApiResult<ReviewItem>>;
};

export const getAllReviewsApi = () => {
  return http.get('/reviews/all') as Promise<ApiResult<ReviewItem[]>>;
};

export const editReviewApi = (date: string, content: string) => {
  return http.post(`/reviews/edit`, content, { params: { date } }) as Promise<ApiResult<string>>;
};

export const getReviewAggregateApi = (startDate: string, endDate: string) => {
  return http.get('/reviews/aggregate', { params: { startDate, endDate } }) as Promise<ApiResult<ReviewAggregateVo>>;
};