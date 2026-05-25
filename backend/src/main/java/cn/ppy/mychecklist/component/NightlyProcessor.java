package cn.ppy.mychecklist.component;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.service.TaskService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 夜间处理器，负责定时执行一些需要在夜间进行的维护任务
 * 那些定期执行的且规模较大的都放在这，夜间一次性处理，避免白天和用户操作冲突导致性能问题
 * 比如：刷新周期任务、统计历史数据等
 */
@Component
@Slf4j
public class NightlyProcessor {

    @Autowired
    private TaskService taskService;

    @Scheduled(cron = "0 0 4 * * *")
    public void processRecurringTasks() {
        log.info("开始执行周期任务刷新 - {}", LocalDateTime.now());

        // 获取所有周期性任务
        List<Task> recurringTasks = taskService.lambdaQuery()
                .eq(Task::getType, TaskType.RECURRING)
                .isNotNull(Task::getCronConfig)
                .list();

        for (Task task : recurringTasks) {
            try {
                // 直接调用刷新方法
                // 内部自带过期判定和状态重置逻辑，不需要外部重复判断
                taskService.refreshTask(task.getTaskId());
            } catch (Exception e) {
                log.error("刷新任务 [{}] 失败", task.getTaskId(), e);
            }
        }

        log.info("周期任务刷新执行完毕");
    }
}
