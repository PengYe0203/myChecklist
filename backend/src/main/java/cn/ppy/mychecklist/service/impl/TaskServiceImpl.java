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

        // 默认初始化值
        if(task.getIsCompleted() == null) task.setIsCompleted(false);
        if(task.getOwnDuration() == null) task.setOwnDuration(0);
        if(task.getSubDurationSum() == null) task.setSubDurationSum(0);
        if(task.getActualDuration() == null) task.setActualDuration(0);
        if(task.getRunStatus() == null) task.setRunStatus(Task.STATUS_NOT_STARTED);

        // 处理继承逻辑：如果有父任务，且未手动指定继承开关，则默认不开启
        if(task.getParentId() != null && task.getParentId() != 0) {
            if(task.getInheritParentTime() == null) {
                task.setInheritParentTime(false);
            }
            
            Task parent = this.getById(task.getParentId());
            if(parent != null) {
                // 如果用户没填，默认继承父任务的上下文（完成时间、开始时间、周期配置）
                if(task.getEndTime() == null) task.setEndTime(parent.getEndTime());
                if(task.getStartTime() == null) task.setStartTime(parent.getStartTime());
                if(task.getCronConfig() == null) task.setCronConfig(parent.getCronConfig());
            }
        }

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
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if (task == null) return;

        int curStatus = task.getRunStatus();
        LocalDateTime now = LocalDateTime.now();

        if (curStatus == Task.STATUS_IN_PROGRESS && newStatus != Task.STATUS_IN_PROGRESS) {
            // 级联停止所有子项
            cascadePauseChildren(taskId, newStatus, context);
            // 停掉并结算自身
            stopTaskTimer(task, newStatus, now, context);
        } else if (curStatus != Task.STATUS_IN_PROGRESS && newStatus == Task.STATUS_IN_PROGRESS) {
            // 开始计时
            task.setLastStartTime(now);
            task.setRunStatus(newStatus);
            context.markModified(task);

            // 自动开始父任务
            activateParentSequentially(task.getParentId(), context);
        }

        this.updateBatchById(context.getModifiedTasks());
    }

    private void stopTaskTimer(Task task, int newStatus, LocalDateTime now, TaskTreeContext context) {
        if (task.getRunStatus() != Task.STATUS_IN_PROGRESS) return;

        // 计算流逝时间
        long duration = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();
        int seconds = (int) duration;

        // 更新时长字段
        int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
        task.setOwnDuration(own + seconds);
        updateActualDuration(task); 
        
        task.setRunStatus(newStatus);
        context.markModified(task);

        // 如果开启了继承，向上同步
        if (Boolean.TRUE.equals(task.getInheritParentTime())) {
            updateParentSubDuration(task.getParentId(), seconds, context);
        }
    }

    private void cascadePauseChildren(Long parentId, int newStatus, TaskTreeContext context) {
        LocalDateTime now = LocalDateTime.now();
        for(Task child: context.getChildren(parentId)) {
            // 先向下递归，让更深层的子任务先结算
            cascadePauseChildren(child.getTaskId(), newStatus, context);
            // 当前 child 拿到了所有后代贡献的最新时长后，再结算自身
            stopTaskTimer(child, newStatus, now, context);
        }
    }

    private void activateParentSequentially(Long parentId, TaskTreeContext context) {
        if (parentId == null || parentId == 0) return;
        Task parent = context.getTask(parentId);
        if (parent == null) return;

        // 如果父任务是未开始状态，切换为进行中
        if (parent.getRunStatus() == Task.STATUS_NOT_STARTED) {
            parent.setRunStatus(Task.STATUS_IN_PROGRESS);
            // 注意：不设置 lastStartTime，防止父任务产生虚假的 ownDuration
            context.markModified(parent);

            // 继续向上递归激活，确保整个任务链条在视觉上都处于“动工”状态
            activateParentSequentially(parent.getParentId(), context);
        }
    }

    private void updateActualDuration(Task task) {
        int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
        int sub = task.getSubDurationSum() == null ? 0 : task.getSubDurationSum();
        task.setActualDuration(own + sub);
    }

    private void updateParentSubDuration(Long parentId, int seconds, TaskTreeContext context) {
        if (parentId == null || parentId == 0) return;
        Task parent = context.getTask(parentId);
        if (parent == null) return;

        int currentSub = parent.getSubDurationSum() == null ? 0 : parent.getSubDurationSum();
        parent.setSubDurationSum(currentSub + seconds);
        updateActualDuration(parent);
        context.markModified(parent);

        // 继续向上递归（只要子任务计入，父任务的父任务也会受影响）
        updateParentSubDuration(parent.getParentId(), seconds, context);
    }

    @Override
    @Transactional
    public String toggleComplete(Long taskId, boolean complete) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if(task == null) return "任务不存在"; 

        processComplete(task, complete, context); //处理本节点

        String feedback = complete ? "已完成" : "已重置";

        if(complete) {
            if(task.getType() != null && task.getType() == Task.TYPE_SIMPLE_TASK) {
                // 随手记：自动完成父任务
                if(checkAndCompleteParent(task.getParentId(), context)) {
                    feedback = "所有子项已完成，已为您自动完成父任务";
                }
            } else {
                // 其它类型：由后端计算是否“建议完成”
                if(shouldSuggestParentComplete(task.getParentId(), context)) {
                    feedback = "SUGGEST_PARENT_COMPLETE"; // 这个暗号给前端，用来触发对话框
                }
            }
            // 父任务完成，所有子任务也强制完成
            processChildrenComplete(taskId, complete, context);
        }else{
            //如果是重置操作，向上取消父节点的完成状态
            cancelParentComplete(task.getParentId(), context);
        }

        this.updateBatchById(context.getModifiedTasks());
        return feedback;
    }

    // 判断是否该弹出完成建议
    private boolean shouldSuggestParentComplete(Long parentId, TaskTreeContext context) {
        if(parentId == null || parentId == 0) return false;
        Task parent = context.getTask(parentId);
        if(parent == null || parent.getIsCompleted()) return false;

        // 如果所有子任务都完成了，则返回 true
        List<Task> children = context.getChildren(parentId);
        if (children.isEmpty()) return false;
        
        return children.stream().allMatch(Task::getIsCompleted);
    }

    // 处理当前任务的完成状态
    private void processComplete(Task task, boolean complete, TaskTreeContext context) {
        if(complete){ //任务完成，把运行状态切换到未开始，记录结束时间
            // 这里不能复用toggleRunStatus方法，因为它没有Context，每次调用都会查询数据库
            if(task.getRunStatus() == Task.STATUS_IN_PROGRESS) {
                LocalDateTime now = LocalDateTime.now();
                long duration = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();
                int seconds = (int) duration;

                // 更新自身时长
                int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
                task.setOwnDuration(own + seconds);
                updateActualDuration(task);

                // 同样要向上同步时长
                if (Boolean.TRUE.equals(task.getInheritParentTime())) {
                    updateParentSubDuration(task.getParentId(), seconds, context);
                }
                
                task.setRunStatus(Task.STATUS_NOT_STARTED);
            }
        }

        task.setIsCompleted(complete);
        context.markModified(task);
    }

    // 递归处理子任务的完成状态
    // 父任务完成，子任务也完成
    private void processChildrenComplete(Long parentId, boolean complete, TaskTreeContext context) {
        for(Task child: context.getChildren(parentId)) {
            processComplete(child, complete, context);
            processChildrenComplete(child.getTaskId(), complete, context);
        }
    }

    // 向上递归检查父任务是否需要完成
    private boolean checkAndCompleteParent(Long parentId, TaskTreeContext context) {
        // 没有父任务了，停止递归
        if(parentId == null || parentId == 0) return false; 

        Task parent = context.getTask(parentId);
        // 父任务不存在、已完成，或者父任务不是“随手记”类型，则停止
        if(parent == null || parent.getIsCompleted() || 
           parent.getType() == null || parent.getType() != Task.TYPE_SIMPLE_TASK) return false; 

        // 如果该随手记父任务的所有子任务都完成了，才自动完成父任务
        boolean allChildrenComplete = context.getChildren(parentId).stream()
                .allMatch(Task::getIsCompleted);

        if(allChildrenComplete) {
            processComplete(parent, true, context); 
            checkAndCompleteParent(parent.getParentId(), context); 
            return true;
        }
        return false;
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
