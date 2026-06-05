package cn.ppy.mychecklist.controller;

import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.service.UserService;
import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.util.Result;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 调试控制器 —— 模拟凌晨四点批处理，方便测试 TaskLogAspect 切面
 * 正式上线前请删除或加上 @Profile("dev") 限制环境
 */
@RestController
@RequestMapping("/api/debug")
@Profile("dev") // 仅在开发环境启用
public class DebugController {

    @Autowired
    private TaskService taskService;

    @Autowired
    private UserService userService;

    /**
     * 手动触发结算：模拟 NightlyProcessor 中对每个用户调用 settleRunningTasks
     * TaskLogAspect 会在 settleRunningTasks 返回后自动生成 TaskLog
     */
    @PostMapping("/triggerNightlySettlement")
    public Result<String> triggerNightlySettlement() {
        List<User> users = userService.list();
        int count = 0;
        for (User user : users) {
            taskService.settleRunningTasks(user.getUserId());
            count++;
        }
        return Result.success("已触发 " + count + " 个用户的跨天结算，检查 task_log 表和日志中的 'AOP: 正在为任务' 即可验证切面是否生效");
    }
}
