package cn.ppy.mychecklist.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.TaskService;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskServiceImpl extends ServiceImpl<TaskMapper, Task> implements TaskService {

    // 任务树结构，方便级联操作，避免频繁查询数据库
    // 写成内部类可以保证只在涉及级联操作时构建，平时不维护，节省资源
    private class TaskTreeContext{
        private final Map<Long, Task> idMap;
        private final Map<Long, List<Task>> childrenMap;
        private final Set<Task> modifiedTasks = new HashSet<>(); //编辑过的task，一次性更新

        public TaskTreeContext(Long userId){
            List<Task> all = query().eq("user_id", userId).list();
            this.idMap = all.stream().collect(Collectors.toMap(Task::getTaskId, t -> t));
            this.childrenMap = all.stream()
                    .filter(t -> t.getParentId() != null && t.getParentId() != 0)
                    .collect(Collectors.groupingBy(Task::getParentId));
        }

        public Task getTask(Long id) { return idMap.get(id); }
        public List<Task> getChildren(Long id) { return childrenMap.getOrDefault(id, Collections.emptyList()); }
        public void markModified(Task task) { modifiedTasks.add(task); }
        public Collection<Task> getModifiedTasks() { return modifiedTasks; }
    }

    private Long getCurrentUserId(){
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    @Override
    public List<Task> getAllTasks() {
        Long currentUser = this.getCurrentUserId();
        return this.query().eq("user_id", currentUser).list();
    }

    @Override
    public String createTask(Task task) {
        Long currentUser = this.getCurrentUserId();
        task.setUserId(currentUser);
        task.setCreateTime(LocalDateTime.now());

        return this.save(task) ? "创建成功" : "创建失败";
    }

    @Override
    public String updateTask(Task task) {
        Task oldTask = this.query()
                .eq("task_id", task.getTaskId())
                .eq("user_id", this.getCurrentUserId())
                .one();

        if(oldTask == null) return "更新失败：任务不存在或不属于当前用户";
        return this.updateById(task) ? "更新成功" : "更新失败";
    }

    @Override
    public String deleteTask(Long id) {
        return this.removeById(id) ? "删除成功" : "删除失败";
    }

    @Override
    @Transactional
    public void toggleActive(Long taskId, boolean active) {
        //这是Controller调用的方法
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        cascadeActive(taskId, active, context);
        this.updateBatchById(context.getModifiedTasks());
    }

    private void cascadeActive(Long taskId, boolean active, TaskTreeContext context) {
        //级联操作要递归，单独成一个方法
        Task task = context.getTask(taskId);
        if(task == null) return; // 任务不存在，直接返回
        task.setActive(active);
        context.markModified(task);

        //向下递归
        for(Task child: context.getChildren(taskId)) {
            cascadeActive(child.getTaskId(), active, context);
        }
    }

    @Override
    @Transactional
    public void toggleRunStatus(Long taskId, int newStatus) {
        Task task = this.getById(taskId);
        if (task == null) return; // 任务不存在，直接返回

        int curStatus = task.getRunStatus();
        LocalDateTime now = LocalDateTime.now();
        if(curStatus == Task.STATUS_IN_PROGRESS && newStatus != Task.STATUS_IN_PROGRESS) {
            // 从进行中切换到暂停，计算实际持续时间
            long duration = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();
            int actualDuration = task.getActualDuration() == null ? 0 : task.getActualDuration();
            task.setActualDuration(actualDuration + (int) duration);
        } else if(curStatus != Task.STATUS_IN_PROGRESS && newStatus == Task.STATUS_IN_PROGRESS) {
            // 从暂停/未开始切换到进行中，开始记录开始时间
            task.setLastStartTime(LocalDateTime.now());
        }

        task.setRunStatus(newStatus);
        this.updateById(task);
    }

    @Override
    @Transactional
    public void toggleComplete(Long taskId, boolean complete) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if(task == null) return; // 任务不存在，直接返回

        processComplete(task, complete, context); //处理本节点
        processChildrenComplete(taskId, complete, context); //处理子节点

        if(complete) {
            //如果是完成操作，向上检查父节点是否也要完成
            checkAndCompleteParent(task.getParentId(), context);
        }else{
            //如果是重置操作，向上取消父节点的完成状态
            cancelParentComplete(task.getParentId(), context);
        }

        this.updateBatchById(context.getModifiedTasks());
    }

    // 处理当前任务的完成状态
    private void processComplete(Task task, boolean complete, TaskTreeContext context) {
        if(complete){ //任务完成，把运行状态切换到未开始，记录结束时间
            // 这里不能复用toggleRunStatus方法，因为它没有Context，每次调用都会查询数据库
            if(task.getRunStatus() == Task.STATUS_IN_PROGRESS) {
                // 这里一定要检查是进行中
                // 因为父任务完成时顺带修改子任务也会调用这个方法
                // 如果子任务不是进行中状态，会导致错误更新
                LocalDateTime now = LocalDateTime.now();
                long duration = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();
                int actualDuration = task.getActualDuration() == null ? 0 : task.getActualDuration();
                task.setActualDuration(actualDuration + (int) duration);
                task.setRunStatus(Task.STATUS_NOT_STARTED);
            }

        }

        // 任务重置不错处理，尽管重置实际用时是一个考量
        // 但是考虑到那些手动验收的任务，用户可能原本觉得完成了，但一段时间后又反悔
        // 这种情况下保留实际用时是更合理的

        task.setIsCompleted(complete);
        context.markModified(task);
    }

    // 递归处理子任务的完成状态
    // 父任务完成，子任务也完成；父任务重置，子任务也重置
    private void processChildrenComplete(Long parentId, boolean complete, TaskTreeContext context) {
        for(Task child: context.getChildren(parentId)) {
            processComplete(child, complete, context);
            processChildrenComplete(child.getTaskId(), complete, context);
        }
    }

    // 向上递归检查父任务是否需要完成
    private void checkAndCompleteParent(Long parentId, TaskTreeContext context) {
        // 没有父任务了，停止递归
        if(parentId == null || parentId == 0) return; 

        // 父任务不存在或已完成，停止递归
        Task parent = context.getTask(parentId);
        if(parent == null || parent.getIsCompleted()) return; 

        // 如果父任务的所有子任务都完成了，才完成父任务
        boolean allChildrenComplete = context.getChildren(parentId).stream()
                .allMatch(Task::getIsCompleted);

        if(allChildrenComplete) {
            processComplete(parent, true, context); //完成父任务
            checkAndCompleteParent(parent.getParentId(), context); //继续向上检查
        }
    }

    // 如果子任务重置了，向上递归取消父任务的完成状态
    private void cancelParentComplete(Long parentId, TaskTreeContext context) {
        // 没有父任务了，停止递归
        if(parentId == null || parentId == 0) return; 

        // 父任务不存在或已经不是完成状态了，停止递归
        Task parent = context.getTask(parentId);
        if(parent == null || !parent.getIsCompleted()) return; 

        // 这里不复用processComplete方法，因为父任务的实际用时等状态不应该改变
        parent.setIsCompleted(false);
        context.markModified(parent);
        cancelParentComplete(parent.getParentId(), context); //继续向上取消
    }


}
