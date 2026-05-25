package cn.ppy.mychecklist.service;

import java.util.List;

import com.baomidou.mybatisplus.extension.service.IService;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.enums.RunStatusType;

public interface TaskService extends IService<Task> {

    void toggleActive(Long taskId, boolean active);

    void toggleRunStatus(Long taskId, RunStatusType newStatus);

    void heartbeat(Long taskId);

    String toggleComplete(Long taskId, boolean complete);

    List<Task> getAllTasks();

    String createTask(Task task);

    String updateTask(Task task);
    
    String deleteTask(Long id);

    String resetTask(Long taskId);

}
