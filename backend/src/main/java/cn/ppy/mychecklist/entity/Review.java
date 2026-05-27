package cn.ppy.mychecklist.entity;

import java.time.LocalDate;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
    
@Data
@TableName("review")
public class Review {

    @TableId(type = IdType.AUTO)
    private Long reviewId;

    private Long userId;
    private LocalDate date;

    // 用户写的主观反馈
    private String content;

    // 凌晨四点自动统计的客观数据
    private Integer doneCount;             // 已完成任务数
    private Integer totalCount;            // 开启的总任务数
    private Integer actualDurationSum;     // 实际总时长（秒）
    private Integer plannedDurationSum;    // 计划总时长（秒）
    private Integer grossEffort;           // 总投入时间（秒）
    private Integer netFocusTime;          // 净专注时间（秒）
    private String timeDistribution;       // 时间分布片段快照 JSON: [[start_sec, end_sec], ...]
    private Integer streakDays;            // 连续坚持天数
}
