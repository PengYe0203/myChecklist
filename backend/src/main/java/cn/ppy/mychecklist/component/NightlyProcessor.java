package cn.ppy.mychecklist.component;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.service.UserService;
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

    @Autowired
    private UserService userService;

    @Scheduled(cron = "0 0 4 * * *")
    public void executeNightlyBatch() {
        log.info("开始执行夜间批处理任务 - {}", LocalDateTime.now());

        // 处理所有用户的跨天任务结算
        settleAllRunningTasks();

        // 刷新周期任务
        processRecurringTasks();

        log.info("夜间批处理任务执行完毕");
    }

    private void settleAllRunningTasks() {
        log.info("开始执行跨天任务结算...");
        List<User> users = userService.list();
        for (User user : users) {
             try {
                 // 结算正在运行的任务（跨过4点的任务在此切断并记入昨日）
                 taskService.settleRunningTasks(user.getUserId());
             } catch (Exception e) {
                 log.error("用户 [{}] 任务结算失败", user.getUserId(), e);
             }
        }
    }

    private void processRecurringTasks() {
        log.info("开始刷新周期任务...");
        // 获取所有周期性任务
        List<Task> recurringTasks = taskService.lambdaQuery()
                .eq(Task::getType, TaskType.RECURRING)
                .isNotNull(Task::getCronConfig)
                .list();

        for (Task task : recurringTasks) {
            try {
                taskService.refreshTask(task.getTaskId());
            } catch (Exception e) {
                log.error("刷新任务 [{}] 失败", task.getTaskId(), e);
            }
        }
    }
}
