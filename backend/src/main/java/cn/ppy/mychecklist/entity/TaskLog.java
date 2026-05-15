package cn.ppy.mychecklist.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("task_log")
public class TaskLog {

    @TableId(type = IdType.AUTO)
    private Long logId;

    private Long taskId;

    private Long userId;

    private LocalDate date;

    private Integer resultStatus; // 0-未开始 1-未完成 2-达标 3-超额完成

    private Integer plannedDuration; //单位为秒

    private Integer actualDuration;

    private LocalDateTime actualStartTime;

    private Integer runStatus; // 0-未开始 1-进行中 2-暂停

    private LocalDateTime lastStartTime; //上次开始时间
}
