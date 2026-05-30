import http from './http';
export const getReviewByDateApi = (date) => {
    return http.get('/reviews', { params: { date } });
};
export const getAllReviewsApi = () => {
    return http.get('/reviews/all');
};
export const editReviewApi = (date, content) => {
    return http.post(`/reviews/edit`, content, { params: { date } });
};
export const getReviewAggregateApi = (startDate, endDate) => {
    return http.get('/reviews/aggregate', { params: { startDate, endDate } });
};
