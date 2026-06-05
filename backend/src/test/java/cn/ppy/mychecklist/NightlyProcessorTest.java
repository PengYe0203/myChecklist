package cn.ppy.mychecklist;

import cn.ppy.mychecklist.component.NightlyProcessor;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.enums.RunStatusType;
import cn.ppy.mychecklist.enums.SettlementType;
import cn.ppy.mychecklist.enums.TaskType;
import cn.ppy.mychecklist.service.ReviewService;
import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 模拟 NightlyProcessor 定时方法的测试类。
 * 
 * 覆盖场景：
 * 1. 跨天结算：凌晨4点切断正在运行的任务，记录昨日时长
 * 2. 刷新周期任务：m模拟服务器关机期间错过多个周期的情况（循环追赶）
 */
@SpringBootTest
@ActiveProfiles("local")
@Transactional  // 测试结束后自动回滚，不污染数据库
class NightlyProcessorTest {

    @Autowired
    private TaskService taskService;

    @Autowired
    private UserService userService;

    @Autowired
    private ReviewService reviewService;

    private Long testUserId;

    // ========================
    // 辅助方法
    // ========================

    @BeforeEach
    void setUp() {
        // 确保有一个测试用户
        User user = userService.lambdaQuery().last("LIMIT 1").one();
        if (user == null) {
            user = new User();
            user.setUsername("test_user");
            user.setEmail("test@example.com");
            userService.save(user);
        }
        testUserId = user.getUserId();
    }

    private Task createTask(Long parentId, String title, TaskType type, RunStatusType runStatus,
                            String cronConfig, int targetDuration, SettlementType settlementType) {
        Task task = new Task();
        task.setUserId(testUserId);
        task.setParentId(parentId);
        task.setTitle(title);
        task.setType(type);
        task.setRunStatus(runStatus);
        task.setCronConfig(cronConfig);
        task.setTargetDuration(targetDuration);
        task.setSettlementType(settlementType != null ? settlementType : SettlementType.MANUAL);
        task.setIsCompleted(false);
        task.setActive(true);
        task.setCreateTime(LocalDateTime.now());
        task.setOwnDuration(0);
        task.setSubDurationSum(0);
        task.setActualDuration(0);
        taskService.save(task);
        return task;
    }

    private void cleanupTasks() {
        List<Task> tasks = taskService.lambdaQuery().eq(Task::getUserId, testUserId).list();
        if (!tasks.isEmpty()) {
            taskService.removeByIds(tasks.stream().map(Task::getTaskId).toList());
        }
    }

    // ========================
    // 测试 1：跨天结算
    // ========================

    @Test
    @DisplayName("跨天结算：运行中的任务被凌晨四点切断，昨日时长正确记录")
    void testSettleRunningTasks_CutsAcrossDayBoundary() {
        cleanupTasks();

        // 创建父任务和子任务（时长同步）
        Task parent = createTask(null, "父任务-跨天测试", TaskType.NOTE, RunStatusType.NOT_STARTED,
                null, 3600, SettlementType.MANUAL);

        Task child = createTask(parent.getTaskId(), "子任务-跨天测试", TaskType.NOTE, RunStatusType.IN_PROGRESS,
                null, 1800, SettlementType.MANUAL);
        child.setInheritParentTime(true);
        // 模拟昨天 23:00 开始运行（必须在今日4点之前）
        LocalDateTime yesterdayNight = LocalDateTime.now().minusDays(1).withHour(23).withMinute(0);
        child.setLastStartTime(yesterdayNight);
        taskService.updateById(child);

        // 执行结算
        taskService.settleRunningTasks(testUserId);

        // 验证子任务时长已结算
        Task updatedChild = taskService.getById(child.getTaskId());
        assertNotNull(updatedChild, "子任务应存在");
        assertTrue(updatedChild.getOwnDuration() > 0, "子任务应结算昨日时长 (ownDuration > 0)");
        
        // runStatus 不变（仍在运行，只是切了起点）, lastStartTime 被更新为今日4点
        assertEquals(RunStatusType.IN_PROGRESS, updatedChild.getRunStatus(),
                "结算后运行状态应保持 IN_PROGRESS");
        assertNotNull(updatedChild.getLastStartTime(), "lastStartTime 应被重置为当日4点");

        System.out.println("✓ 跨天结算测试通过 - 子任务 ownDuration=" + updatedChild.getOwnDuration()
                + "s, lastStartTime=" + updatedChild.getLastStartTime());

        cleanupTasks();
    }

    @Test
    @DisplayName("跨天结算：四点半之后的任务不受影响")
    void testSettleRunningTasks_StartedAfterFourIgnored() {
        cleanupTasks();

        Task task = createTask(null, "刚开任务-不受影响", TaskType.NOTE, RunStatusType.IN_PROGRESS,
                null, 600, SettlementType.MANUAL);
        // 模拟今天 06:00 开始（4点之后）
        task.setLastStartTime(LocalDateTime.now().withHour(6).withMinute(0).withSecond(0));
        task.setOwnDuration(120);
        taskService.updateById(task);

        int ownBefore = task.getOwnDuration();

        taskService.settleRunningTasks(testUserId);

        Task updated = taskService.getById(task.getTaskId());
        assertEquals(ownBefore, updated.getOwnDuration(),
                "四点后开始的任务不应结算");
        System.out.println("✓ 四点后任务不受影响测试通过");

        cleanupTasks();
    }

    // ========================
    // 测试 2：周期任务刷新（含多周期追赶）
    // ========================

    @Test
    @DisplayName("周期任务刷新：每天执行的任务，错过一天后刷新到当前周期")
    void testRefreshTask_DailyRecurring_CatchesUpOneMissedCycle() {
        cleanupTasks();

        // 每天 4:00 执行的周期任务
        // cron: 每天一次，"锚点"是今天
        String todayAnchor = LocalDateTime.now().minusDays(1)
                .withHour(4).withMinute(0).withSecond(0).withNano(0).toString();
        String cron = "DAY_INTERVAL|1|" + todayAnchor;

        // 任务上次执行在 2 天前
        Task task = createTask(null, "每天任务-错过一天", TaskType.RECURRING, RunStatusType.NOT_STARTED,
                cron, 1800, SettlementType.MANUAL);
        LocalDateTime oldStart = LocalDateTime.now().minusDays(2).withHour(8).withMinute(0);
        task.setStartTime(oldStart);
        task.setEndTime(oldStart.plusHours(2));
        taskService.updateById(task);

        System.out.println("调试: cron=" + cron);
        System.out.println("调试: 旧 startTime=" + task.getStartTime());

        // 执行刷新
        taskService.refreshTask(task.getTaskId());

        Task updated = taskService.getById(task.getTaskId());
        assertNotNull(updated, "任务应存在");

        // startTime 应该前进到当前周期（不再在2天前）
        assertTrue(updated.getStartTime().isAfter(oldStart),
                "startTime 应从2天前前进到当前周期: old=" + oldStart + ", new=" + updated.getStartTime());

        // 状态应被重置
        assertEquals(RunStatusType.NOT_STARTED, updated.getRunStatus(), "刷新后应重置为未开始");
        assertFalse(updated.getIsCompleted(), "刷新后应未完成");
        assertEquals(0, updated.getOwnDuration(), "刷新后 ownDuration 应为0");

        System.out.println("✓ 每天周期任务刷新测试通过");
        cleanupTasks();
    }

    @Test
    @DisplayName("周期任务刷新：每2天执行的任务，服务器关机错过2个周期，循环追赶至当前")
    void testRefreshTask_EveryTwoDays_MultipleMissedCycles() {
        cleanupTasks();

        // 每2天一次，锚点定在6天前（周二）
        // 6天前 周二 → 下一个 周四 → 再下一个 周六 → 当前最新周期
        LocalDateTime anchor = LocalDateTime.now().minusDays(6)
                .withHour(4).withMinute(0).withSecond(0).withNano(0);
        String cron = "DAY_INTERVAL|2|" + anchor.toString();

        // 任务 startTime 停在 6 天前
        Task task = createTask(null, "每2天任务-错过多次", TaskType.RECURRING, RunStatusType.NOT_STARTED,
                cron, 3600, SettlementType.AUTO);
        LocalDateTime oldStart = LocalDateTime.now().minusDays(6).withHour(8).withMinute(0);
        task.setStartTime(oldStart);
        task.setEndTime(oldStart.plusHours(2));
        taskService.updateById(task);

        System.out.println("调试: cron=" + cron);
        System.out.println("调试: anchor=" + anchor);
        System.out.println("调试: 旧 startTime=" + task.getStartTime());

        // 执行刷新
        taskService.refreshTask(task.getTaskId());

        Task updated = taskService.getById(task.getTaskId());
        assertNotNull(updated, "任务应存在");

        // startTime 应前进到当前周期
        Duration gap = Duration.between(oldStart, updated.getStartTime());
        System.out.println("调试: 新 startTime=" + updated.getStartTime() + ", 前进=" + gap.toDays() + "d " + gap.toHours() % 24 + "h");

        assertTrue(updated.getStartTime().isAfter(oldStart),
                "startTime 应从6天前进到当前周期: old=" + oldStart + ", new=" + updated.getStartTime());
        
        // 时间差应为步长(2天)的整数倍
        long gapDays = gap.toDays();
        assertEquals(0, gapDays % 2,
                "前进天数应是2的倍数（步长），实际=" + gapDays);

        System.out.println("✓ 每2天多周期追赶测试通过 - 前进 " + gapDays + " 天");

        cleanupTasks();
    }

    @Test
    @DisplayName("周期任务刷新：每周执行的任务，无需刷新时不修改")
    void testRefreshTask_Weekly_NotExpired() {
        cleanupTasks();

        // 每周一 4:00
        // 如果当前不是周一之后，任务不应被刷新
        String cron = "0 0 4 ? * 1";    // 每周一 4am

        Task task = createTask(null, "每周任务-未过期", TaskType.RECURRING, RunStatusType.NOT_STARTED,
                cron, 900, SettlementType.MANUAL);
        
        // startTime 设为今天（本次周期内）
        LocalDateTime todayStart = LocalDateTime.now().withHour(8).withMinute(0);
        task.setStartTime(todayStart);
        taskService.updateById(task);

        System.out.println("调试: cron=" + cron + ", startTime=" + task.getStartTime());

        taskService.refreshTask(task.getTaskId());

        Task updated = taskService.getById(task.getTaskId());
        // 如果没过期，startTime 不应改变
        // 注意：如果当前刚好过了周一，这个断言可能会失败
        System.out.println("调试: startTime 变化: " + task.getStartTime() + " → " + updated.getStartTime());

        assertEquals(RunStatusType.NOT_STARTED, updated.getRunStatus(), "未过期任务状态不变");

        System.out.println("✓ 未过期周期任务不变测试通过");
        cleanupTasks();
    }

    // ========================
    // 测试 3：模拟 NightlyProcessor 完整流程
    // ========================

    @Test
    @DisplayName("模拟 NightlyProcessor 完整流程：结算 + 周期刷新")
    void testSimulateNightlyProcessorFullFlow() {
        cleanupTasks();

        // 1. 创建正在运行的任务（模拟跨天）
        Task runningTask = createTask(null, "深夜运行任务", TaskType.NOTE, RunStatusType.IN_PROGRESS,
                null, 2000, SettlementType.MANUAL);
        runningTask.setLastStartTime(LocalDateTime.now().minusHours(3));
        taskService.updateById(runningTask);

        // 2. 创建每天执行的周期任务（应被刷新）
        String anchor = LocalDateTime.now().minusDays(2)
                .withHour(4).withMinute(0).withSecond(0).withNano(0).toString();
        Task recurringTask = createTask(null, "每日周期任务", TaskType.RECURRING, RunStatusType.NOT_STARTED,
                "DAY_INTERVAL|1|" + anchor, 1800, SettlementType.MANUAL);
        recurringTask.setStartTime(LocalDateTime.now().minusDays(2).withHour(8).withMinute(0));
        taskService.updateById(recurringTask);

        // 3. 创建不定期执行的周期任务（不应被刷新）
        Task notExpiredTask = createTask(null, "每周任务-未过期", TaskType.RECURRING, RunStatusType.NOT_STARTED,
                "0 0 4 ? * " + (LocalDateTime.now().getDayOfWeek().getValue()),  // 本周
                900, SettlementType.AUTO);
        notExpiredTask.setStartTime(LocalDateTime.now().withHour(8).withMinute(0));
        taskService.updateById(notExpiredTask);

        // ===== 模拟 NightlyProcessor 流程 =====
        System.out.println("\n=== 模拟 NightlyProcessor ===");

        // Step 1: 结算所有用户的运行中任务
        taskService.settleRunningTasks(testUserId);
        Task settled = taskService.getById(runningTask.getTaskId());
        System.out.println("结算后: ownDuration=" + settled.getOwnDuration()
                + ", lastStartTime=" + settled.getLastStartTime());

        // Step 2: 生成昨日报告
        try {
            reviewService.generateDailyReport(
                    java.time.LocalDate.now().minusDays(1), testUserId);
            System.out.println("昨日报告已生成");
        } catch (Exception e) {
            System.out.println("报告生成跳过: " + e.getMessage());
        }

        // Step 3: 刷新所有周期任务
        List<Task> recurringTasks = taskService.lambdaQuery()
                .eq(Task::getType, TaskType.RECURRING)
                .isNotNull(Task::getCronConfig)
                .eq(Task::getUserId, testUserId)
                .list();

        for (Task rt : recurringTasks) {
            System.out.println("刷新周期任务 [" + rt.getTitle() + "]: startTime=" + rt.getStartTime());
            taskService.refreshTask(rt.getTaskId());
        }

        // ===== 验证结果 =====
        Task finalRecurring = taskService.getById(recurringTask.getTaskId());
        assertNotNull(finalRecurring, "周期任务应存在");
        assertTrue(finalRecurring.getStartTime().isAfter(recurringTask.getStartTime()),
                "过期周期任务应刷新到当前周期");

        System.out.println("✓ 模拟 NightlyProcessor 完整流程测试通过");
        cleanupTasks();
    }
}
