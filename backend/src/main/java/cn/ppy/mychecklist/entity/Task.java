package cn.ppy.mychecklist.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("task")
public class Task {

    @TableId(type = IdType.AUTO)
    private Long taskId;

    private Long userId;

    private String title;

    private String description;

    private Long parentId;

    private LocalDateTime createTime;

    private Boolean isCompleted;

    private Integer type; // 任务类型：0-随手记，1-周期任务，2-DDL

    private Integer settlementType; // 结算类型：0-手动结算，1-自动结算

    private Integer targetDuration; // 单位为秒

    private LocalDateTime startTime;

    private LocalDateTime endTime;

    private String cronConfig; // 用于周期任务的cron表达式

    private LocalDateTime due; // DDL

    private Integer actualDuration; // 实际持续时间，单位为秒

    private Integer runStatus; // 运行状态：0-未开始，1-进行中，2-暂停

    private LocalDateTime lastStartTime; // 上次运行时间
}
