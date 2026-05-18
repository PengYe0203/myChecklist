package cn.ppy.mychecklist.service.impl;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.TaskService;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskServiceImpl extends ServiceImpl<TaskMapper, Task> implements TaskService {

    @Override
    public List<Task> getAllTasks() {
        Long currentUser = 1L; // TODO: 之后实现登录系统后再获取当前用户ID
        return this.query().eq("user_id", currentUser).list();
    }

    @Override
    public String createTask(Task task) {
        return this.save(task) ? "创建成功" : "创建失败";
    }

    @Override
    public String updateTask(Task task) {
        return this.updateById(task) ? "更新成功" : "更新失败";
    }

    @Override
    public String deleteTask(Long id) {
        return this.removeById(id) ? "删除成功" : "删除失败";
    }

    @Override
    public void toggleActive(Long taskId, boolean active) {
        //todo: 切换周期任务的启停状态，即更新isActive字段
    }

}
