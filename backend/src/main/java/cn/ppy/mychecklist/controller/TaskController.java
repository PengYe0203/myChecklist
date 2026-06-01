package cn.ppy.mychecklist.controller;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.enums.RunStatusType;
import cn.ppy.mychecklist.service.TaskService;
import cn.ppy.mychecklist.util.Result;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;


@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    @Autowired
    private TaskService taskService;

    @GetMapping("/getAllTasks")
    public Result<List<Task>> getAllTasks() {
        List<Task> tasks = taskService.getAllTasks();
        return Result.success(tasks); // 本来就可以是空的，不需要单独处理
    }

    @PostMapping("/createTask")
    public Result<String> createTask(@RequestBody Task task) {
        String msg = taskService.createTask(task);
        if(msg.contains("成功")) {
            return Result.success(msg);
        }
        return Result.error(msg);
    }

    @PostMapping("/updateTask")
    public Result<String> updateTask(@RequestBody Task task) {
        String msg = taskService.updateTask(task);
        if(msg.contains("成功")) {
            return Result.success(msg);
        }
        return Result.error(msg);
    }

    @PostMapping("/delete/{id}")
    public Result<String> deleteTask(@PathVariable Long id) {
        String msg = taskService.deleteTask(id);
        if(msg.contains("成功")) {
            return Result.success(msg);
        }
        return Result.error(msg);
    }

    @PostMapping("/reset/{id}")
    public Result<String> resetTask(@PathVariable Long id) {
        String msg = taskService.resetTask(id);
        return Result.success(msg);
    }

    @PostMapping("/toggleActive/{id}")
    public Result<String> toggleActive(@PathVariable Long id, @RequestParam boolean active) {
        taskService.toggleActive(id, active);
        return Result.success("状态切换成功");
    }

    @PostMapping("/toggleComplete/{id}")
    public Result<String> toggleComplete(@PathVariable Long id, @RequestParam boolean complete) {
        String msg = taskService.toggleComplete(id, complete);
        return Result.success(msg);
    }

    @PostMapping("/heartbeat/{id}")
    public Result<String> heartbeat(@PathVariable Long id) {
        taskService.heartbeat(id);
        return Result.success("心跳同步成功");
    }

    @PostMapping("/toggleRunStatus/{id}")
    public Result<String> toggleRunStatus(@PathVariable Long id, @RequestParam String status) {
        RunStatusType runStatus;
        try {
            runStatus = RunStatusType.valueOf(status);
        } catch (IllegalArgumentException e) {
            return Result.error("无效的运行状态: " + status);
        }
        taskService.toggleRunStatus(id, runStatus);
        return Result.success("运行状态切换成功");
    }
}
