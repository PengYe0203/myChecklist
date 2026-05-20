package cn.ppy.mychecklist.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.TaskService;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskServiceImpl extends ServiceImpl<TaskMapper, Task> implements TaskService {

    private Long getCurrentUserId(){
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    @Override
    public List<Task> getAllTasks() {
        Long currentUser = this.getCurrentUserId();
        return this.query().eq("user_id", currentUser).list();
    }

    @Override
    public String createTask(Task task) {
        Long currentUser = this.getCurrentUserId();
        task.setUserId(currentUser);
        task.setCreateTime(LocalDateTime.now());

        return this.save(task) ? "创建成功" : "创建失败";
    }

    @Override
    public String updateTask(Task task) {
        Task oldTask = this.query()
                .eq("task_id", task.getTaskId())
                .eq("user_id", this.getCurrentUserId())
                .one();

        if(oldTask == null) return "更新失败：任务不存在或不属于当前用户";
        return this.updateById(task) ? "更新成功" : "更新失败";
    }

    @Override
    public String deleteTask(Long id) {
        return this.removeById(id) ? "删除成功" : "删除失败";
    }

    @Override
    @Transactional
    public void toggleActive(Long taskId, boolean active) {
        Task task = this.getById(taskId);
        if (task == null) return; // 任务不存在，直接返回

        // 更新当前任务状态
        task.setActive(active);
        this.updateById(task);

        // 级联逻辑：使用递归实现
        // 任务启停时，所有子任务跟着一起动
        List<Task> subTasks = this.query().eq("parent_id", taskId).list();
        for (Task subTask : subTasks) {
            toggleActive(subTask.getTaskId(), active);
        }
    }

}
