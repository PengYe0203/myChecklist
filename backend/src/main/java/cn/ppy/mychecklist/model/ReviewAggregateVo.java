package cn.ppy.mychecklist.model;

import java.time.LocalDate;
import java.util.List;

import lombok.Data;

@Data
public class ReviewAggregateVo {

    private Integer reviewCount;           // 得到的复盘总数

    private Integer doneCount;             // 已完成任务数
    private Integer totalCount;            // 开启的总任务数
    private Integer actualDurationSum;     // 实际总时长（秒）
    private Integer plannedDurationSum;    // 计划总时长（秒）
    private Integer grossEffort;           // 总投入时间（秒）
    private Integer netFocusTime;          // 净专注时间（秒）
    private List<LocalDate> activeDistribution;       // 有任务的天数分布
    private List<LocalDate> streakDistribution;     // 完成所有任务的天数
}
