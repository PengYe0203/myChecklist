package cn.ppy.mychecklist.aspect;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.enums.LogResultStatus;
import cn.ppy.mychecklist.enums.SettlementType;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.mapper.TaskLogMapper;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.util.CronUtils;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 任务日志切面
 */
@Aspect
@Component
@Slf4j
public class TaskLogAspect {

    @Autowired
    private TaskMapper taskMapper;

    @Autowired
    private TaskLogMapper taskLogMapper;

    // 周期触发：发生在refreshTask之前，针对周期性任务
    @Before("execution(* ..TaskService.refreshTask(..)) && args(taskId)")
    public void recordLogBeforeRefresh(JoinPoint joinPoint, Long taskId) {
        Task task = taskMapper.selectById(taskId);
        if (task == null) return;

        // 只有当该任务真正刷新时才记录日志
        // 避免每月刷新的任务也每天凌晨都记录一次log
        if (task.getStartTime() != null && task.getCronConfig() != null) {
            //这个周期的开始时间
            LocalDateTime referencePoint = task.getStartTime().withHour(4).withMinute(0).withSecond(0).withNano(0);
            if (task.getStartTime().isBefore(referencePoint)) {
                referencePoint = referencePoint.minusDays(1);
            }
            if (!CronUtils.isExpired(task.getCronConfig(), referencePoint)) {
                // 还没到刷新周期，不记录日志
                return; 
            }
        }

        doRecord(task);
    }

    // 事件触发：在用户手动确认完成时，立即记录/更新日志
    @AfterReturning(pointcut = "execution(* ..TaskService.toggleComplete(..)) && args(taskId, complete)", returning = "result")
    public void recordLogOnComplete(Long taskId, boolean complete, String result) {
        if (complete) {
            Task task = taskMapper.selectById(taskId);
            if (task != null) doRecord(task);
        }
    }

    //生成log
    private void doRecord(Task task) {
        // 场景任务(SCENE)仅作为组织容器，没有时长和完成度指标，不记录日志
        if (task.getType() == TaskType.SCENE) return;

        log.info("AOP: 正在为任务 [{}] 生成快照日志...", task.getTitle());
        
        //log本身信息：用户、任务、任务执行日期
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(task.getTaskId());
        taskLog.setUserId(task.getUserId());
        taskLog.setDate(task.getStartTime() != null ? task.getStartTime().toLocalDate() : LocalDate.now());
        
        //任务信息的快照，以防后续用户更新任务，导致数据失真
        taskLog.setTitle(task.getTitle());
        taskLog.setType(task.getType());
        taskLog.setPlannedDuration(task.getTargetDuration());
        taskLog.setParentId(task.getParentId());
        
        //执行结果
        taskLog.setActualDuration(task.getActualDuration() != null ? task.getActualDuration() : 0);
        taskLog.setActualStartTime(task.getLastStartTime());
        taskLog.setResultStatus(calculateResultStatus(task));
        taskLog.setWorkSegments(task.getCurrentDaySegments());
        
        //幂等检查：如果已经记录过了，则更新而不是新增
        TaskLog existing = taskLogMapper.selectOne(
            new LambdaQueryWrapper<TaskLog>()
                .eq(TaskLog::getTaskId, task.getTaskId())
                .eq(TaskLog::getDate, taskLog.getDate())
        );

        if (existing != null) {
            taskLog.setLogId(existing.getLogId());
            taskLogMapper.updateById(taskLog);
        } else {
            taskLogMapper.insert(taskLog);
        }
    }

    private LogResultStatus calculateResultStatus(Task task) {
        boolean isDone = Boolean.TRUE.equals(task.getIsCompleted());
        int actual = task.getActualDuration() == null ? 0 : task.getActualDuration();
        int target = task.getTargetDuration() == null ? 0 : task.getTargetDuration();
        LocalDateTime now = LocalDateTime.now();

        // 未完成或未开始
        if (!isDone) {
            return actual > 0 ? LogResultStatus.NOT_COMPLETED : LogResultStatus.NOT_STARTED;
        }

        // 判断是否超时完成
        // DDL任务：指标是“截止时间endTime”
        if (task.getType() == TaskType.DEADLINE) {
            if (task.getEndTime() != null && now.isAfter(task.getEndTime())) {
                return LogResultStatus.LATE_COMPLETED;
            }
        } 
        // 手动确认的周期任务：指标是“计划用时plannedDuration”
        else if (task.getType() == TaskType.RECURRING && task.getSettlementType() == SettlementType.MANUAL) {
            if (target > 0 && actual < target) {
                return LogResultStatus.LATE_COMPLETED;
            }
        }
        // 其他情况：
        // 自动确认的周期任务：到点即正常完成，没有超时概念
        // 随手记：只有正常完成，没有超时概念

        return LogResultStatus.COMPLETED;
    }
}
