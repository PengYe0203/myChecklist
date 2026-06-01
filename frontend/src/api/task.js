import http from './http';
export const getAllTasksApi = () => {
    return http.get('/tasks/getAllTasks');
};
export const createTaskApi = (task) => {
    return http.post('/tasks/createTask', task);
};
export const updateTaskApi = (task) => {
    return http.post('/tasks/updateTask', task);
};
export const deleteTaskApi = (id) => {
    return http.post(`/tasks/delete/${id}`);
};
export const resetTaskApi = (id) => {
    return http.post(`/tasks/reset/${id}`);
};
export const toggleActiveApi = (id, active) => {
    return http.post(`/tasks/toggleActive/${id}`, null, { params: { active } });
};
export const toggleCompleteApi = (id, complete) => {
    return http.post(`/tasks/toggleComplete/${id}`, null, { params: { complete } });
};
export const toggleRunStatusApi = (id, status) => {
    return http.post(`/tasks/toggleRunStatus/${id}`, null, { params: { status } });
};
export const heartbeatApi = (id) => {
    return http.post(`/tasks/heartbeat/${id}`);
};
