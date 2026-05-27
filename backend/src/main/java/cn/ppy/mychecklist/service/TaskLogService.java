package cn.ppy.mychecklist.service;

import cn.ppy.mychecklist.entity.TaskLog;
import com.baomidou.mybatisplus.extension.service.IService;

import java.time.LocalDate;
import java.util.List;

public interface TaskLogService extends IService<TaskLog> {
    
    List<TaskLog> getLogsByDate(Long userId, LocalDate date);

}
