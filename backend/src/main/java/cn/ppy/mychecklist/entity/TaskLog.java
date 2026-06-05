package cn.ppy.mychecklist.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import cn.ppy.mychecklist.enums.LogResultStatus;
import cn.ppy.mychecklist.enums.TaskType;
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

    //task的快照，预防用户直接在已有任务上修改了任务属性导致日志数据不一致
    private String title;
    private TaskType type; // 任务类型：0-随手记，1-周期任务，2-DDL，3-场景
    private Integer plannedDuration; //单位为秒
    private Long parentId; // 父任务ID，只是用来统计，不会真去查询父任务

    //task的执行结果
    private Integer actualDuration;
    private Integer dailyActualDuration; // 当日投入时长(秒)
    private LogResultStatus resultStatus; // 0-未开始 1-未完成 2-完成 3-超时完成
    private String workSegments; // 当日执行片段快照
}
