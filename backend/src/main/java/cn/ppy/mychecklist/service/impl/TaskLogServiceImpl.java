package cn.ppy.mychecklist.service.impl;

import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.mapper.TaskLogMapper;
import cn.ppy.mychecklist.service.TaskLogService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
public class TaskLogServiceImpl extends ServiceImpl<TaskLogMapper, TaskLog> implements TaskLogService {

    @Override
    public List<TaskLog> getLogsByDate(Long userId, LocalDate date) {
        return this.list(new LambdaQueryWrapper<TaskLog>()
                .eq(TaskLog::getUserId, userId)
                .eq(TaskLog::getDate, date)
                .orderByDesc(TaskLog::getLogId)); // 可以根据需要修改排序规则
    }

}
