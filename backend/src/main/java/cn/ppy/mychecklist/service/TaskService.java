package cn.ppy.mychecklist.service;

import java.util.List;

import com.baomidou.mybatisplus.extension.service.IService;
import cn.ppy.mychecklist.entity.Task;

public interface TaskService extends IService<Task> {

    void toggleActive(Long taskId, boolean active);

    void toggleRunStatus(Long taskId, int newStatus);
    String toggleComplete(Long taskId, boolean complete);

    List<Task> getAllTasks();
    String createTask(Task task);
    String updateTask(Task task);
    String deleteTask(Long id);

}
