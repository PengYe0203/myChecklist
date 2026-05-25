package cn.ppy.mychecklist.component;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.enums.RunStatusType;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.TaskService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

@Component
public class TaskGuardian {

    @Value("${checklist.heartbeat.timeout-threshold:300}")
    private int timeoutThreshold;

    @Value("${checklist.heartbeat.interval:60s}")
    private Duration heartbeatInterval;

    @Autowired
    private TaskService taskService;

    @Autowired
    private TaskMapper taskMapper;

    //每隔一个心跳间隔执行一次，检查所有运行中的任务上次心跳是什么时候
    //如果超过设定的阈值，就认为任务已死，触发暂停逻辑
    @Scheduled(fixedRateString = "${checklist.heartbeat.interval:60s}")
    public void scavengeZombieTasks() {
        LocalDateTime now = LocalDateTime.now();
        // 找出所有正在运行的任务
        List<Task> runningTasks = taskMapper.selectList(
            new LambdaQueryWrapper<Task>().eq(Task::getRunStatus, RunStatusType.IN_PROGRESS)
        );

        for (Task task : runningTasks) {
            // 使用配置的超时阈值
            if (task.getLastStartTime() != null && 
                java.time.Duration.between(task.getLastStartTime(), now).getSeconds() > timeoutThreshold) {
                
                // 强制触发暂停逻辑，调用toggleRunStatus处理级联
                taskService.toggleRunStatus(task.getTaskId(), RunStatusType.PAUSED);
                
                System.out.println("Guardian: 任务 [" + task.getTitle() + "] 心跳超时，已自动暂停。");
            }
        }
    }
}
