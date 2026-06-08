package cn.ppy.mychecklist.aspect;

import cn.ppy.mychecklist.component.BloomFilter;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.enums.LogResultStatus;
import cn.ppy.mychecklist.enums.SettlementType;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.mapper.TaskLogMapper;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.util.CronUtils;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 任务日志切面，只有一个功能：
 * 每天凌晨四点时，NightlyProcessor会调用TaskService.settleRunningTasks()方法处理跨天任务
 * 这个方法返回后，就会被这个切片拦截，生成前一天的TaskLog记录，并写入数据库和Redis
 */
@Aspect
@Component
@Slf4j
public class TaskLogAspect {

    @Autowired
    private TaskMapper taskMapper;

    @Autowired
    private TaskLogMapper taskLogMapper;

    @Autowired
    private BloomFilter bloomFilter;

    // 跨天的时候为所有任务都生成日志，记录任务的执行结果
    @AfterReturning(pointcut = "this(cn.ppy.mychecklist.service.TaskService) && execution(* settleRunningTasks(..)) && args(userId)")
    public void recordLogAfterSettlement(Long userId) {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime boundary = now.withHour(4).withMinute(0).withSecond(0).withNano(0);
        if (now.isBefore(boundary)) boundary = boundary.minusDays(1);
        LocalDate logDate = boundary.minusDays(1).toLocalDate();

        // 查询前一天的TaskLog，用 actualDuration 差值计算当日贡献
        LocalDate prevDate = logDate.minusDays(1);
        List<TaskLog> prevLogs = taskLogMapper.selectList(new LambdaQueryWrapper<TaskLog>()
                .eq(TaskLog::getUserId, userId)
                .eq(TaskLog::getDate, prevDate));
        Map<Long, Integer> prevActualMap = prevLogs.stream()
                .collect(Collectors.toMap(TaskLog::getTaskId,
                        log -> log.getActualDuration() != null ? log.getActualDuration() : 0,
                        (a, b) -> a));

        List<Task> tasks = taskMapper.selectList(new LambdaQueryWrapper<Task>()
                .eq(Task::getUserId, userId));
        for (Task task : tasks) {
            doRecord(task, logDate, boundary, prevActualMap);
        }
    }

    private void doRecord(Task task, LocalDate logDate, LocalDateTime boundary,
            Map<Long, Integer> prevActualMap) {
        // 场景任务(SCENE)仅作为组织容器，没有时长和完成度指标，不记录日志
        if (task.getType() == TaskType.SCENE) return;

        log.info("AOP: 正在为任务 [{}] 生成快照日志...", task.getTitle());
        
        //log本身信息：用户、任务、任务执行日期
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(task.getTaskId());
        taskLog.setUserId(task.getUserId());
        LocalDate recordDate = logDate;
        taskLog.setDate(recordDate);
        
        //任务信息的快照，以防后续用户更新任务，导致数据失真
        taskLog.setTitle(task.getTitle());
        taskLog.setType(task.getType());
        taskLog.setPlannedDuration(task.getTargetDuration());
        taskLog.setParentId(task.getParentId());
        
        //执行结果
        int curActual = task.getActualDuration() != null ? task.getActualDuration() : 0;
        taskLog.setActualDuration(curActual);
        // 当日贡献 = 当前累计actualDuration - 前一日TaskLog中的actualDuration
        int prevActual = prevActualMap.getOrDefault(task.getTaskId(), 0);
        taskLog.setDailyActualDuration(Math.max(0, curActual - prevActual));
        taskLog.setResultStatus(calculateResultStatus(task, boundary));
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

        // 把TaskLog加入布隆过滤器
        bloomFilter.add(BloomFilter.NS_TASKLOG, String.valueOf(taskLog.getLogId()));
    }

    private LogResultStatus calculateResultStatus(Task task, LocalDateTime boundary) {
        boolean isDone = Boolean.TRUE.equals(task.getIsCompleted());
        int actual = task.getActualDuration() == null ? 0 : task.getActualDuration();
        int target = task.getTargetDuration() == null ? 0 : task.getTargetDuration();

        // 未完成、未开始、暂不要求
        if (!isDone) {
            if (!isDueToComplete(task, boundary)) {
                return LogResultStatus.DEFERRED;
            } else {
                return actual > 0 ? LogResultStatus.NOT_COMPLETED : LogResultStatus.NOT_STARTED;
            }
        }

        // 完成、超时完成
        // DDL任务：指标是“截止时间endTime”
        if (task.getType() == TaskType.DEADLINE) {
            // boudary是第二天的4点，所以需要减1天，否则ddl当天完成的任务会被误判为超时完成
            if (task.getEndTime() != null && boundary.minusDays(1).isAfter(task.getEndTime())) {
                return LogResultStatus.LATE_COMPLETED;
            }
        } 
        // 手动确认的周期任务：指标是“计划用时plannedDuration”
        else if (task.getType() == TaskType.RECURRING && task.getSettlementType() == SettlementType.MANUAL) {
            if (target > 0 && actual > target) {
                return LogResultStatus.LATE_COMPLETED;
            }
        }

        return LogResultStatus.COMPLETED;
    }

    private boolean isDueToComplete(Task task, LocalDateTime boundary) {
        // boundary是第二天的凌晨4点
        // 随手记和DDL任务：有截止日期且已经过了，才算未开始/未完成，否则记为暂不要求
        if (task.getType() != TaskType.RECURRING && task.getEndTime() != null) {
            return task.getEndTime().isBefore(boundary);
        }

        // 周期任务：如果过期说明未开始/未完成，否则暂不要求
        if (task.getType() == TaskType.RECURRING && task.getStartTime() != null && task.getCronConfig() != null) {
            LocalDateTime referencePoint = task.getStartTime().withHour(4).withMinute(0).withSecond(0).withNano(0);
            if (task.getStartTime().isBefore(referencePoint)) {
                referencePoint = referencePoint.minusDays(1);
            }
            return CronUtils.isExpired(task.getCronConfig(), referencePoint);
        }

        return false;
    }

}
