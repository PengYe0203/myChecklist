package cn.ppy.mychecklist.component;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.service.ReviewService;
import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.service.UserService;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.TimeUnit;

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

    @Autowired
    private ReviewService reviewService;

    @Autowired
    private RedissonClient redissonClient;

    private static final String NIGHTLY_LOCK_KEY = "lock:nightly-batch";
    private static final long LOCK_WAIT_SECONDS = 5;
    private static final long LOCK_LEASE_SECONDS = 300; // 5分钟自动释放，防止死锁

    @Scheduled(cron = "0 0 4 * * *")
    public void executeNightlyBatch() {
        RLock lock = redissonClient.getLock(NIGHTLY_LOCK_KEY);
        boolean acquired = false;
        try {
            acquired = lock.tryLock(LOCK_WAIT_SECONDS, LOCK_LEASE_SECONDS, TimeUnit.SECONDS);
            if (!acquired) {
                log.info("夜间批处理任务已被其他实例执行，跳过");
                return;
            }

            log.info("开始执行夜间批处理任务 - {}", LocalDateTime.now());
            LocalDate yesterday = LocalDate.now().minusDays(1);

            // 处理所有用户的跨天任务结算并生成昨日报告
            settleAndReportAllUsers(yesterday);

            // 刷新周期任务
            processRecurringTasks();

            log.info("夜间批处理任务执行完毕");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("夜间批处理任务获取锁被中断");
        } finally {
            if (acquired) {
                try {
                    lock.unlock();
                } catch (Exception e) {
                    log.warn("释放夜间批处理分布式锁失败", e);
                }
            }
        }
    }

    private void settleAndReportAllUsers(LocalDate yesterday) {
        log.info("开始执行结算与报告生成...");
        List<User> users = userService.list();
        log.info("共 {} 个用户需要结算", users.size());
        for (User user : users) {
             try {
                 // 结算正在运行的任务（跨过4点的任务在此切断）
                 taskService.settleRunningTasks(user.getUserId());
                 
                 // 生成昨日报告（关注客观数据）
                 reviewService.generateDailyReport(yesterday, user.getUserId());
             } catch (Exception e) {
                 // 区分连接异常和业务异常，方便排查
                 String exClassName = e.getClass().getSimpleName();
                 if (e.getMessage() != null && (e.getMessage().contains("Communications") || e.getMessage().contains("timeout") || e.getMessage().contains("connection"))) {
                     log.warn("用户 [{}] 结算失败(疑似连接断开): {} - {}", user.getUserId(), exClassName, e.getMessage());
                 } else {
                     log.error("用户 [{}] 结算或报告生成失败", user.getUserId(), e);
                 }
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
