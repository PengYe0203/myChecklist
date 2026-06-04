package cn.ppy.mychecklist.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.enums.RunStatusType;
import cn.ppy.mychecklist.enums.SettlementType;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.util.CronUtils;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskServiceImpl extends ServiceImpl<TaskMapper, Task> implements TaskService {

    @Value("${checklist.heartbeat.timeout-threshold:300}")
    private int timeoutThreshold;

    @Value("${checklist.heartbeat.interval:60s}")
    private Duration heartbeatInterval;

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
        if(task.getRunStatus() == null) task.setRunStatus(RunStatusType.NOT_STARTED);

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

        // 如果是周期任务，自动规范化时间上下文
        if(task.getType() == TaskType.RECURRING) {
            normalizeRecurringSchedule(task);
        }

        // 校验：如果同时存在起止时间，结束时间不得早于开始时间
        if (task.getStartTime() != null && task.getEndTime() != null) {
            if (task.getEndTime().isBefore(task.getStartTime())) {
                return "创建失败：结束时间不能早于开始时间";
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

        if(task.getType() == TaskType.RECURRING) {
            normalizeRecurringSchedule(task);
        }

        // 校验：结束时间不得早于开始时间
        if (task.getStartTime() != null && task.getEndTime() != null) {
            if (task.getEndTime().isBefore(task.getStartTime())) {
                return "更新失败：结束时间不能早于开始时间";
            }
        }

        // 这里需要显式set每个字段
        // 因为如果直接updateById, 可能会忽略空字段，导致用户无法清空这些属性
        UpdateWrapper<Task> updateWrapper = new UpdateWrapper<>();
        updateWrapper.eq("task_id", task.getTaskId())
            .eq("user_id", this.getCurrentUserId())
            .set("parent_id", task.getParentId())
            .set("title", task.getTitle())
            .set("description", task.getDescription())
            .set("type", task.getType())
            .set("settlement_type", task.getSettlementType())
            .set("target_duration", task.getTargetDuration())
            .set("start_time", task.getStartTime())
            .set("end_time", task.getEndTime())
            .set("cron_config", task.getCronConfig())
            .set("inherit_parent_time", task.getInheritParentTime())
            .set("is_active", task.isActive())
            .set("is_completed", task.getIsCompleted());

        

        return this.update(updateWrapper) ? "更新成功" : "更新失败";
    }

    private void normalizeRecurringSchedule(Task task) {
        if (task == null || task.getType() != TaskType.RECURRING) return;
        if (task.getCronConfig() == null || task.getCronConfig().isBlank()) return;

        LocalDateTime nextCycleStart = CronUtils.getNextExecution(task.getCronConfig(), LocalDateTime.now());
        if (nextCycleStart == null) return;

        // 日期设置为下一周期开始，时分保持不变
        if (task.getStartTime() != null) {
            task.setStartTime(nextCycleStart.toLocalDate().atTime(task.getStartTime().toLocalTime()));
        }

        if (task.getEndTime() != null) {
            task.setEndTime(nextCycleStart.toLocalDate().atTime(task.getEndTime().toLocalTime()));
        }

        if (task.getCronConfig().startsWith("DAY_INTERVAL|")) {
            try {
                int first = task.getCronConfig().indexOf('|');
                int second = task.getCronConfig().indexOf('|', first + 1);
                if (first > 0 && second > first) {
                    int stepDays = Math.max(1, Integer.parseInt(task.getCronConfig().substring(first + 1, second)));
                    task.setCronConfig("DAY_INTERVAL|" + stepDays + "|" + nextCycleStart);
                }
            } catch (Exception ignored) {
                // 保持原 cronConfig，不让格式问题阻断保存
            }
        }
    }

    @Override
    @Transactional
    public String deleteTask(Long id) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        if (context.getTask(id) == null) return "删除失败：任务不存在或无权限";

        List<Long> idsToDelete = new ArrayList<>();
        cascadeDelete(id, idsToDelete, context);

        return this.removeByIds(idsToDelete) ? "删除成功" : "删除失败";
    }

    private void cascadeDelete(Long id, List<Long> list, TaskTreeContext context) {
        list.add(id);
        for (Task child : context.getChildren(id)) {
            cascadeDelete(child.getTaskId(), list, context);
        }
    }

    @Override
    @Transactional
    public String resetTask(Long taskId) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if (task == null) return "任务不存在";

        //重置该任务及其所有子任务的时长和完成状态
        cascadeReset(taskId, context);

        this.updateBatchById(context.getModifiedTasks());
        return "任务及子项已重置";
    }

    private void cascadeReset(Long taskId, TaskTreeContext context) {
        Task task = context.getTask(taskId);
        if (task == null) return;

        //重置运行状态和完成状态
        task.setRunStatus(RunStatusType.NOT_STARTED);
        task.setIsCompleted(false);

        //重置时间上下文
        task.setOwnDuration(0);
        task.setSubDurationSum(0);
        task.setActualDuration(0);
        task.setLastStartTime(null);
        
        context.markModified(task);

        //向下级联
        for (Task child : context.getChildren(taskId)) {
            cascadeReset(child.getTaskId(), context);
        }
    }

    @Override
    @Transactional
    public void toggleActive(Long taskId, boolean active) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if (task == null) return;
        if (task.isActive() == active) return; // 已是目标状态
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
    public void toggleRunStatus(Long taskId, RunStatusType newStatus) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if (task == null || task.getType() == TaskType.SCENE) return;

        RunStatusType curStatus = task.getRunStatus();
        if (curStatus == newStatus) return; // 状态未变，不处理
        LocalDateTime now = LocalDateTime.now();

        // 行级锁：串行化同任务的 toggleRunStatus 和 heartbeat
        query().eq("task_id", taskId).last("FOR UPDATE").one();

        if (curStatus == RunStatusType.IN_PROGRESS && newStatus != RunStatusType.IN_PROGRESS) {
            // 级联停止所有子项
            cascadePauseChildren(taskId, newStatus, now, context);
            // 停掉并结算自身
            stopTaskTimer(task, newStatus, now, context);
        } else if (curStatus != RunStatusType.IN_PROGRESS && newStatus == RunStatusType.IN_PROGRESS) {
            // 开始计时
            task.setLastStartTime(now);
            task.setRunStatus(newStatus);
            context.markModified(task);

            // 自动开始父任务
            activateParentSequentially(task.getParentId(), context);
        }

        this.updateBatchById(context.getModifiedTasks());
    }

    private void stopTaskTimer(Task task, RunStatusType newStatus, LocalDateTime now, TaskTreeContext context) {
        if (task.getRunStatus() != RunStatusType.IN_PROGRESS || task.getType() == TaskType.SCENE) return;

        // 计算流逝时间
        LocalDateTime lastStart = task.getLastStartTime();
        long duration = java.time.Duration.between(lastStart, now).getSeconds();
        int seconds = (int) duration;

        // 记录时间片段用于分布统计
        recordSegment(task, lastStart, now);

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

    private void recordSegment(Task task, LocalDateTime startTime, LocalDateTime endTime) {
        if (startTime == null || endTime == null) return;
        
        // 计算相对于当日凌晨4点的秒数
        LocalDateTime ref = endTime.withHour(4).withMinute(0).withSecond(0).withNano(0);
        // 如果结束时间在4点及之前，它属于上一个周期的闭合点
        if (!endTime.isAfter(ref)) ref = ref.minusDays(1);
        
        long startSec = java.time.Duration.between(ref, startTime).getSeconds();
        long endSec = java.time.Duration.between(ref, endTime).getSeconds();
        
        // 跨天处理：如果开始时间在参考点之前（即属于前一天），截断到0
        if (startSec < 0) startSec = 0;
        if (endSec < startSec) return;
        
        String current = task.getCurrentDaySegments();
        StringBuilder sb = new StringBuilder();
        
        if (current == null || current.trim().isEmpty() || "[]".equals(current)) {
            sb.append("[[").append(startSec).append(",").append(endSec).append("]]");
        } else {
            sb.append(current); // [[s1,e1],[s2,e2]]
            if (sb.length() > 0 && sb.charAt(sb.length() - 1) == ']') {
                sb.setLength(sb.length() - 1); // [[s1,e1],[s2,e2]
            }
            // "[[s1,e1],[s2,e2]" + ",[s3, e3]]"
            sb.append(",[").append(startSec).append(",").append(endSec).append("]]");
        }
        task.setCurrentDaySegments(sb.toString());
    }

    private void cascadePauseChildren(Long parentId, RunStatusType newStatus, LocalDateTime stopTime, TaskTreeContext context) {
        for(Task child: context.getChildren(parentId)) {
            // 先向下递归，让更深层的子任务先结算
            cascadePauseChildren(child.getTaskId(), newStatus, stopTime, context);
            // 当前 child 拿到了所有后代贡献的最新时长后，再结算自身
            stopTaskTimer(child, newStatus, stopTime, context);
        }
    }

    private void activateParentSequentially(Long parentId, TaskTreeContext context) {
        if (parentId == null || parentId == 0) return;
        Task parent = context.getTask(parentId);
        if (parent == null || parent.getType() == TaskType.SCENE) return;

        // 如果父任务是未开始状态，切换为进行中
        if (parent.getRunStatus() == RunStatusType.NOT_STARTED) {
            parent.setRunStatus(RunStatusType.IN_PROGRESS);
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
        if (parent == null || parent.getType() == TaskType.SCENE) return;

        int currentSub = parent.getSubDurationSum() == null ? 0 : parent.getSubDurationSum();
        parent.setSubDurationSum(currentSub + seconds);
        updateActualDuration(parent);
        context.markModified(parent);

        // 继续向上递归
        if (Boolean.TRUE.equals(parent.getInheritParentTime())) {
            updateParentSubDuration(parent.getParentId(), seconds, context);
        }
    }


    @Override
    @Transactional
    public void heartbeat(Long taskId) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if (task == null || task.getRunStatus() != RunStatusType.IN_PROGRESS || task.getType() == TaskType.SCENE) return;

        // 行级锁：串行化同任务的 toggleRunStatus 和 heartbeat
        query().eq("task_id", taskId).last("FOR UPDATE").one();

        LocalDateTime now = LocalDateTime.now();
        long seconds = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();

        // 超时保护逻辑
        // 使用配置的阈值（默认300s）
        if (seconds > timeoutThreshold) {
            LocalDateTime stopTime = task.getLastStartTime().plus(heartbeatInterval);
            // 级联停止所有子项，结算时间统一为：父任务最后一次心跳起点 + 补偿间隔
            cascadePauseChildren(taskId, RunStatusType.PAUSED, stopTime, context);
            // 停掉并结算自身
            stopTaskTimer(task, RunStatusType.PAUSED, stopTime, context);
            
            this.updateBatchById(context.getModifiedTasks());
            return;
        }

        if (seconds <= 0) return;

        // 正常心跳结算
        int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
        task.setOwnDuration(own + (int)seconds);
        updateActualDuration(task);
        
        if (Boolean.TRUE.equals(task.getInheritParentTime())) {
            updateParentSubDuration(task.getParentId(), (int)seconds, context);
        }

        // 滑动时间起点
        task.setLastStartTime(now);
        context.markModified(task);
        this.updateBatchById(context.getModifiedTasks());

        // 自动结项逻辑
        // 如果是自动结算任务，且目标时长已达成，则触发自动完成
        if (parentAndTaskReadyForAutoComplete(task)) {
            this.toggleComplete(taskId, true);
        }
    }

    private boolean parentAndTaskReadyForAutoComplete(Task task) {
        return task.getSettlementType() == SettlementType.AUTO 
            && task.getTargetDuration() != null 
            && task.getTargetDuration() > 0 
            && task.getActualDuration() >= task.getTargetDuration();
    }

    @Override
    @Transactional
    public String toggleComplete(Long taskId, boolean complete) {
        TaskTreeContext context = new TaskTreeContext(this.getCurrentUserId());
        Task task = context.getTask(taskId);
        if(task == null || task.getType() == TaskType.SCENE) return "任务不存在";

        // 幂等：已是目标状态则跳过
        if (task.getIsCompleted() != null && task.getIsCompleted() == complete) {
            return complete ? "已完成" : "已撤回";
        }

        // 行级锁：heartbeat 可能并发调用 toggleComplete(true)
        query().eq("task_id", taskId).last("FOR UPDATE").one();

        processComplete(task, complete, context); //处理本节点

        String feedback = complete ? "已完成" : "已撤回";

        if(complete) {
            //向下级联：如果手动完成了一个父任务，强制完成其所有子任务
            processChildrenComplete(taskId, complete, context);

            //向上追溯：根据新逻辑判定父任务是否该跟着完成
            feedback = resolveCompletionUpward(task.getParentId(), context, feedback);
        } else {
            // 重置逻辑：向上取消父节点的完成状态
            cancelParentComplete(task.getParentId(), context);
        }

        this.updateBatchById(context.getModifiedTasks());
        return feedback;
    }


    //实现新设计的向上追溯完成逻辑
    private String resolveCompletionUpward(Long parentId, TaskTreeContext context, String currentFeedback) {
        if (parentId == null || parentId == 0) return currentFeedback;
        Task parent = context.getTask(parentId);
        if (parent == null || parent.getType() == TaskType.SCENE || parent.getIsCompleted()) return currentFeedback;

        // 检查所有兄弟任务是否都已经完成
        List<Task> children = context.getChildren(parentId);
        boolean allFinished = children.stream().allMatch(Task::getIsCompleted);
        // 如果兄弟任务还没全部完成，则无论父任务是什么类型，都不触发后续逻辑
        if (!allFinished) return currentFeedback;

        //此时所有兄弟任务都已完成
        //如果父任务是随手记，直接完成并继续向上追溯
        if (parent.getType() == TaskType.NOTE) {
            processComplete(parent, true, context);
            return resolveCompletionUpward(parent.getParentId(), context, "所有子项已完成，已为您自动完成父任务");
        }

        //如果父任务是自动确认的任务，检查用时是否抵达要求
        if (parent.getSettlementType() == SettlementType.AUTO) {
            int target = parent.getTargetDuration() == null ? 0 : parent.getTargetDuration();
            int actual = parent.getActualDuration() == null ? 0 : parent.getActualDuration();
            if (actual >= target) {
                processComplete(parent, true, context);
                return resolveCompletionUpward(parent.getParentId(), context, "目标时长已达成，已为您自动完成父任务");
            }
            // 用时未抵达要求，不自动完成，也不弹出询问（等待心跳或后续操作）
            return currentFeedback;
        }

        //如果父任务是手动确认的任务，返回暗号询问用户
        if (parent.getSettlementType() == SettlementType.MANUAL) {
            return "SUGGEST_PARENT_COMPLETE";
        }

        return currentFeedback;
    }

    // 处理当前任务的完成状态
    private void processComplete(Task task, boolean complete, TaskTreeContext context) {
        if (task.getType() == TaskType.SCENE) return;

        if(complete){ //任务完成，把运行状态切换到未开始，记录结束时间
            // 这里不能复用toggleRunStatus方法，因为涉及了级联操作，本方法只关注单个任务的完成
            if(task.getRunStatus() == RunStatusType.IN_PROGRESS) {
                LocalDateTime now = LocalDateTime.now();
                long duration = java.time.Duration.between(task.getLastStartTime(), now).getSeconds();
                int seconds = (int) duration;

                // 更新自身时长
                int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
                task.setOwnDuration(own + seconds);
                updateActualDuration(task);

                // 记录时间片段用于分布统计
                recordSegment(task, task.getLastStartTime(), now);

                // 向上同步时长
                if (Boolean.TRUE.equals(task.getInheritParentTime())) {
                    updateParentSubDuration(task.getParentId(), seconds, context);
                }
                
                task.setRunStatus(RunStatusType.NOT_STARTED);
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

    @Override
    @Transactional
    public void refreshTask(Long taskId) {
        // 供NightlyProcessor调用，定期刷新周期任务
        Task task = this.getById(taskId);
        if (task == null || task.getType() != TaskType.RECURRING || task.getCronConfig() == null) return;
        
        LocalDateTime oldStartTime = task.getStartTime();
        String cron = task.getCronConfig();

        if (oldStartTime != null) {
            // 获取当前周期的开始时间点
            // 那些四点前的任务算前一天的任务
            LocalDateTime referencePoint = oldStartTime.withHour(4).withMinute(0).withSecond(0).withNano(0);
            if (oldStartTime.isBefore(referencePoint)) {
                referencePoint = referencePoint.minusDays(1);
            }

            // 判断是否要刷新
            if (!CronUtils.isExpired(cron, referencePoint)) {
                return; 
            }

            LocalDateTime nextReferencePoint = CronUtils.getNextExecution(cron, referencePoint);
            if (nextReferencePoint != null) {
                //获取两个周期的时间差
                //再应用到startTime和endTime，保证只有日期变化，而小时分钟不变
                java.time.Duration gap = java.time.Duration.between(referencePoint, nextReferencePoint);
                task.setStartTime(oldStartTime.plus(gap));
                if (task.getEndTime() != null) {
                    task.setEndTime(task.getEndTime().plus(gap));
                }
            }
        }

        // 刷新任务的时间上下文和状态
        task.setRunStatus(RunStatusType.NOT_STARTED);
        task.setIsCompleted(false);
        task.setOwnDuration(0);
        task.setSubDurationSum(0);
        task.setActualDuration(0);
        task.setLastStartTime(null);
        task.setCurrentDaySegments("[]");

        this.updateById(task);
    }

    @Override
    @Transactional
    public void settleRunningTasks(Long userId) {
        // 处理跨天时的计时问题
        // boundary是调用时刻当天的凌晨4点
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime boundary = now.withHour(4).withMinute(0).withSecond(0).withNano(0);
        if (now.isBefore(boundary)) boundary = boundary.minusDays(1);
        
        // 构建树上下文，因为涉及跨天结算时的父任务时长同步
        TaskTreeContext context = new TaskTreeContext(userId);
        
        // 找出所有正在运行的任务
        List<Task> runningTasks = context.idMap.values().stream()
                .filter(t -> t.getRunStatus() == RunStatusType.IN_PROGRESS)
                .collect(Collectors.toList());

        boolean hasChanges = false;
        for (Task task : runningTasks) {
            if (task.getLastStartTime() != null && task.getLastStartTime().isBefore(boundary)) {
                hasChanges = true;
                // 计算昨日的时长
                LocalDateTime lastStart = task.getLastStartTime();
                long secondsYesterday = java.time.Duration.between(lastStart, boundary).getSeconds();
                int seconds = (int) secondsYesterday;

                // 记录昨日片段
                recordSegment(task, lastStart, boundary);
                
                // 结算昨日时长到自身
                int own = task.getOwnDuration() == null ? 0 : task.getOwnDuration();
                task.setOwnDuration(own + seconds);
                updateActualDuration(task);
                
                // 重置今日起点（核心：不改状态，只改起点）
                task.setLastStartTime(boundary);
                context.markModified(task);
                
                // 级联同步：让父任务也能结算到子任务昨日贡献的时长
                if (Boolean.TRUE.equals(task.getInheritParentTime())) {
                    updateParentSubDuration(task.getParentId(), seconds, context);
                }
            }
        }
        
        if (hasChanges) {
            this.updateBatchById(context.getModifiedTasks());
        }
    }


}
