package cn.ppy.mychecklist.controller;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.service.TaskService;
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
    public List<Task> getAllTasks() {
        return taskService.getAllTasks();
    }

    @PostMapping("/createTask")
    public String createTask(@RequestBody Task task) {
        return taskService.createTask(task);
    }

    @PostMapping("/updateTask")
    public String updateTask(@RequestBody Task task) {
        return taskService.updateTask(task);
    }

    @PostMapping("/delete/{id}")
    public String deleteTask(@PathVariable Long id) {
        return taskService.deleteTask(id);
    }

}
