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
import cn.ppy.mychecklist.util.RedisUtils;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    @Autowired
    private RedisUtils redisUtils;

    @Autowired
    private BloomFilter bloomFilter;

    // Redis相关常量
    private static final String CACHE_KEY_PREFIX = "taskLog:detail:";
    private static final long CACHE_TTL_SECONDS = 3600; // 1小时，主要为Review服务，生成完立马使用

    // 跨天的时候为所有任务都生成日志，记录任务的执行结果
    @AfterReturning(pointcut = "execution(* ..TaskService.settleRunningTasks(..)) && args(userId)")
    public void recordLogAfterSettlement(Long userId) {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime boundary = now.withHour(4).withMinute(0).withSecond(0).withNano(0);
        if (now.isBefore(boundary)) boundary = boundary.minusDays(1);
        LocalDate logDate = boundary.minusDays(1).toLocalDate();

        List<Task> tasks = taskMapper.selectList(new LambdaQueryWrapper<Task>()
                .eq(Task::getUserId, userId));
        for (Task task : tasks) {
            doRecord(task, logDate, boundary);
        }
    }

    private void doRecord(Task task, LocalDate logDate, LocalDateTime boundary) {
        // 场景任务(SCENE)仅作为组织容器，没有时长和完成度指标，不记录日志
        if (task.getType() == TaskType.SCENE) return;

        log.info("AOP: 正在为任务 [{}] 生成快照日志...", task.getTitle());
        
        //log本身信息：用户、任务、任务执行日期
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(task.getTaskId());
        taskLog.setUserId(task.getUserId());
        LocalDate recordDate = logDate != null
            ? logDate
            : (task.getStartTime() != null ? task.getStartTime().toLocalDate() : LocalDate.now());
        taskLog.setDate(recordDate);
        
        //任务信息的快照，以防后续用户更新任务，导致数据失真
        taskLog.setTitle(task.getTitle());
        taskLog.setType(task.getType());
        taskLog.setPlannedDuration(task.getTargetDuration());
        taskLog.setParentId(task.getParentId());
        
        //执行结果
        taskLog.setActualDuration(task.getActualDuration() != null ? task.getActualDuration() : 0);
        taskLog.setDailyActualDuration(calculateDailyDuration(task.getCurrentDaySegments()));
        taskLog.setActualStartTime(task.getLastStartTime());
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

        // 把TaskLog写入Redis
        String cacheKey = CACHE_KEY_PREFIX + taskLog.getLogId();
        try {
            String json = objectMapper.writeValueAsString(taskLog);
            redisUtils.set(cacheKey, json, CACHE_TTL_SECONDS);
        } catch (JsonProcessingException e) {
            log.error("TaskLog序列化失败, 无法写入Redis, logId={}", taskLog.getLogId(), e);
            return;
        }
        // 把TaskLog加入布隆过滤器
        bloomFilter.add(BloomFilter.NS_TASKLOG, String.valueOf(taskLog.getLogId()));
    }

    private LogResultStatus calculateResultStatus(Task task, LocalDateTime boundary) {
        boolean isDone = Boolean.TRUE.equals(task.getIsCompleted());
        int actual = task.getActualDuration() == null ? 0 : task.getActualDuration();
        int target = task.getTargetDuration() == null ? 0 : task.getTargetDuration();
        LocalDateTime now = boundary != null ? boundary : LocalDateTime.now();

        // 未完成或未开始
        if (!isDone) {
            if (actual > 0) return LogResultStatus.NOT_COMPLETED;
            return isDueToComplete(task, now) ? LogResultStatus.NOT_STARTED : LogResultStatus.DEFERRED;
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

    private boolean isDueToComplete(Task task, LocalDateTime boundary) {
        if (task.getType() == TaskType.DEADLINE && task.getEndTime() != null) {
            return task.getEndTime().isBefore(boundary);
        }

        if (task.getType() == TaskType.RECURRING && task.getStartTime() != null && task.getCronConfig() != null) {
            LocalDateTime referencePoint = task.getStartTime().withHour(4).withMinute(0).withSecond(0).withNano(0);
            if (task.getStartTime().isBefore(referencePoint)) {
                referencePoint = referencePoint.minusDays(1);
            }
            return CronUtils.isExpired(task.getCronConfig(), referencePoint);
        }

        return false;
    }

    // 根据执行时段得到当日执行时长
    private int calculateDailyDuration(String segmentsJson) {
        if (segmentsJson == null || segmentsJson.isEmpty() || "[]".equals(segmentsJson)) {
            return 0;
        }

        int total = 0;
        Pattern p = Pattern.compile("\\[(\\d+),(\\d+)\\]");
        Matcher m = p.matcher(segmentsJson);
        while (m.find()) {
            int start = Integer.parseInt(m.group(1));
            int end = Integer.parseInt(m.group(2));
            total += (end - start);
        }
        return total;
    }
}
