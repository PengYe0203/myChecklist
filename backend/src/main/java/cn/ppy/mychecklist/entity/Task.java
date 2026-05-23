package cn.ppy.mychecklist.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("task")
public class Task {

    // 任务类型常量
    public static final int TYPE_SIMPLE_TASK = 0; // 随手记
    public static final int TYPE_PERIODIC_TASK = 1; // 周期任务
    public static final int TYPE_DDL_TASK = 2; // DDL
    public static final int TYPE_SCENE_TASK = 3; // 场景

    // 结算类型常量
    public static final int SETTLEMENT_MANUAL = 0; // 手动结算
    public static final int SETTLEMENT_AUTO = 1; // 自动结算

    // 运行状态常量
    public static final int STATUS_NOT_STARTED = 0; // 未开始
    public static final int STATUS_IN_PROGRESS = 1; // 进行中
    public static final int STATUS_PAUSED = 2; // 暂停

    @TableId(type = IdType.AUTO)
    private Long taskId;

    private Long userId;

    private String title;

    private String description;

    private Long parentId;

    private LocalDateTime createTime;

    private Boolean isCompleted;

    private Integer type; // 任务类型：0-随手记，1-周期任务，2-DDL，3-场景

    private Integer settlementType; // 结算类型：0-手动结算，1-自动结算

    private Integer targetDuration; // 单位为秒

    private LocalDateTime startTime; // 计划开始时间

    private LocalDateTime endTime; // 计划完成时间

    private String cronConfig; // 用于周期任务的cron表达式

    private Integer actualDuration; // 有效总时长(秒)

    private Integer ownDuration; // 任务自身投入时长(秒)

    private Integer subDurationSum; // 子任务累计投入时长(秒)

    private Boolean inheritParentTime; // 是否计入父任务时长

    private Integer runStatus; // 运行状态：0-未开始，1-进行中，2-暂停

    private LocalDateTime lastStartTime; // 上次运行时间

    private boolean isActive; // 是否激活，主要用于周期任务的启停
}
