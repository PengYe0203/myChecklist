package cn.ppy.mychecklist.controller;

import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.service.TaskLogService;
import cn.ppy.mychecklist.util.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/task-logs")
public class TaskLogController {

    @Autowired
    private TaskLogService taskLogService;

    // 获取当前登录用户 ID，与 TaskController 保持一致
    private Long getCurrentUserId() {
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    /**
     * 获取指定日期的所有任务日志
     * 例如 GET /api/task-logs?date=2026-05-26
     */
    @GetMapping
    public Result<List<TaskLog>> getLogsByDate(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        Long userId = getCurrentUserId();
        List<TaskLog> logs = taskLogService.getLogsByDate(userId, date);
        return Result.success(logs);
    }

    /**
     * 获取单条任务日志的详情
     * 例如 GET /api/task-logs/123
     */
    @GetMapping("/{logId}")
    public Result<TaskLog> getLogById(@PathVariable Long logId) {
        Long userId = getCurrentUserId();
        TaskLog taskLog = taskLogService.getById(logId);
        
        // 权限校验：只能查看自己的日志
        if (taskLog == null || !taskLog.getUserId().equals(userId)) {
            return Result.error("非法访问：日志不存在或无权限");
        }
        
        return Result.success(taskLog);
    }
}
