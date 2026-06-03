package cn.ppy.mychecklist.service.impl;

import cn.ppy.mychecklist.component.BloomFilter;
import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.mapper.TaskLogMapper;
import cn.ppy.mychecklist.service.TaskLogService;
import cn.ppy.mychecklist.util.RedisUtils;
import lombok.extern.slf4j.Slf4j;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Slf4j
@Service
public class TaskLogServiceImpl extends ServiceImpl<TaskLogMapper, TaskLog> implements TaskLogService {

    private static final String CACHE_KEY_PREFIX = "taskLog:detail:";
    private static final String CACHE_KEY_LIST_PREFIX = "taskLog:list:";
    private static final long CACHE_TTL_SECONDS = 3600; // 1小时，主要为Review服务，生成完立马使用

    @Autowired
    private RedisUtils redisUtils;

    @Autowired
    private BloomFilter bloomFilter;

    // 某个TaskLog的key为 taskLog:detail:{logId}
    private String detailKey(Long taskLogId) {
        return CACHE_KEY_PREFIX + taskLogId;
    }

    // 某个用户某天的TaskLog列表key为 taskLog:list:{userId}:{date}
    private String listKey(Long userId, LocalDate date) {
        return CACHE_KEY_LIST_PREFIX + userId + ":" + date;
    }

    // 按日期查询某用户的所有TaskLog
    @Override
    public List<TaskLog> getLogsByDate(Long userId, LocalDate date) {
        String cacheKey = listKey(userId, date);
        String lockKey = "lock:" + cacheKey; //逻辑过期用到的分布式锁

        // getOrRebuild内部：查Redis -> 逻辑过期判定 -> 加锁查DB -> 自动回填缓存
        TaskLogListResult result = redisUtils.getOrRebuild(
                cacheKey, lockKey, CACHE_TTL_SECONDS,
                TaskLogListResult.class,
                () -> {
                    // loader.get()的内容，缓存不存在或过期时执行
                    List<TaskLog> queryResult = TaskLogServiceImpl.super.list(
                            new LambdaQueryWrapper<TaskLog>()
                                    .eq(TaskLog::getUserId, userId)
                                    .eq(TaskLog::getDate, date)
                                    .orderByDesc(TaskLog::getLogId));

                    // 所有 logId 写入布隆过滤器（与缓存同步）
                    for (TaskLog taskLog : queryResult) {
                        bloomFilter.add(BloomFilter.NS_TASKLOG, String.valueOf(taskLog.getLogId()));
                    }

                    TaskLogListResult wrapper = new TaskLogListResult();
                    wrapper.taskLogs = queryResult;
                    return wrapper;
                });

        return result != null ? result.taskLogs : null;
    }

    // 按TaskLog_ID查询
    @Override
    public TaskLog getById(Long taskLogId) {

        // 布隆过滤器快速判无
        if (!bloomFilter.mightContain(BloomFilter.NS_TASKLOG, String.valueOf(taskLogId))) {
            log.debug("BloomFilter判定TaskLog不存在 logId={}", taskLogId);
            return null;
        }

        String cacheKey = detailKey(taskLogId);
        String lockKey = "lock:" + cacheKey;

        // 查询Redis，必要时查询DB并回填Redis
        return redisUtils.getOrRebuild(
                cacheKey, lockKey, CACHE_TTL_SECONDS,
                TaskLog.class,
                () -> {
                    TaskLog taskLog = super.getById(taskLogId);
                    if (taskLog != null) { //写入布隆过滤器（与缓存同步）
                        bloomFilter.add(BloomFilter.NS_TASKLOG, String.valueOf(taskLogId));
                    }
                    return taskLog;
                });
    }

    // 给getOrReubild使用的包装类
    @SuppressWarnings("unused")
    private static class TaskLogListResult {
        public List<TaskLog> taskLogs;
    }
}
