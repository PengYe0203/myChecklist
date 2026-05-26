package cn.ppy.mychecklist.service.impl;

import cn.ppy.mychecklist.entity.Review;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.mapper.ReviewMapper;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.service.ReviewService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class ReviewServiceImpl extends ServiceImpl<ReviewMapper, Review> implements ReviewService {

    @Autowired
    private TaskMapper taskMapper;

    @Override
    @Transactional
    public void generateDailyReport(LocalDate date, Long userId) {
        // 获取所有活跃任务
        List<Task> activeTasks = taskMapper.selectList(new LambdaQueryWrapper<Task>()
                .eq(Task::getUserId, userId)
                .eq(Task::isActive, true));

        if (activeTasks.isEmpty()) {
            // 即便没有活跃任务，也要确保清空可能存在的残余执行片段
            clearAllTaskSegments(userId);
            return;
        }

        List<int[]> allSegments = new ArrayList<>(); //所有时间片段，不区分任务
        long grossEffort = 0; //不去重的总时长
        int doneCount = 0; //完成的任务数
        int activeCount = activeTasks.size(); //活跃的任务数
        int actualSum = 0; //实际总时长
        int targetSum = 0; //计划总时长

        // 片段格式为 [[s1,e1],[s2,e2]]
        Pattern p = Pattern.compile("\\[(\\d+),(\\d+)\\]");
        
        for (Task task : activeTasks) {
            if (Boolean.TRUE.equals(task.getIsCompleted())) doneCount++;

            // 计划总时和实际总时
            actualSum += (task.getActualDuration() != null ? task.getActualDuration() : 0);
            targetSum += (task.getTargetDuration() != null ? task.getTargetDuration() : 0);

            // 收集并处理时间分布片段
            String segmentsJson = task.getCurrentDaySegments();
            if (segmentsJson != null && !segmentsJson.isEmpty() && !segmentsJson.equals("[]")) {
                Matcher m = p.matcher(segmentsJson);
                while (m.find()) {
                    int start = Integer.parseInt(m.group(1));
                    int end = Integer.parseInt(m.group(2));
                    allSegments.add(new int[]{start, end});
                    grossEffort += (end - start);
                }
            }
        }

        // 合并区间得到去重的工作时间块，并计算去重后的工作时间
        List<int[]> mergedSegments = getMergedSegments(allSegments);
        long netFocusTime = mergedSegments.stream().mapToLong(s -> s[1] - s[0]).sum();
        String distribution = mergedSegments.stream()
                .map(s -> "[" + s[0] + "," + s[1] + "]")
                .collect(Collectors.joining(",", "[", "]"));

        // 计算连续坚持天数 (Streak Days)
        // 只有当所有活跃任务都完成时，才增加连续天数
        int streak = 0;
        if (doneCount == activeCount && activeCount > 0) { 
            // 查询昨天的记录
            Review yesterdayReview = this.lambdaQuery()
                    .eq(Review::getUserId, userId)
                    .eq(Review::getDate, date.minusDays(1))
                    .one();
            
            if(yesterdayReview != null && yesterdayReview.getStreakDays() != null) {
                streak = yesterdayReview.getStreakDays() + 1;
            } else {
                streak = 1; // 从今天开始新的连续记录
            }
        }

        // 检查是否已有记录：用户可能当天就写了反馈
        Review review = this.lambdaQuery()
                .eq(Review::getUserId, userId)
                .eq(Review::getDate, date)
                .one();
        
        if (review == null) {
            review = new Review();
            review.setUserId(userId);
            review.setDate(date);
        }

        review.setDoneCount(doneCount);
        review.setTotalCount(activeCount);
        review.setActualDurationSum(actualSum);
        review.setPlannedDurationSum(targetSum);
        review.setGrossEffort((int) grossEffort);
        review.setNetFocusTime((int) netFocusTime);
        review.setTimeDistribution(distribution);
        review.setStreakDays(streak);

        this.saveOrUpdate(review);

        // 清空该用户所有任务的片段记录
        clearAllTaskSegments(userId);
    }

    private void clearAllTaskSegments(Long userId) {
        // 把该用户所有的时间片段重置
        taskMapper.update(null, new LambdaUpdateWrapper<Task>()
                .set(Task::getCurrentDaySegments, "[]")
                .eq(Task::getUserId, userId)
                .isNotNull(Task::getCurrentDaySegments)
                .ne(Task::getCurrentDaySegments, "[]"));
    }

    // 区间合并
    private List<int[]> getMergedSegments(List<int[]> segments) {
        if (segments.isEmpty()) return new ArrayList<>();
        
        // 按开始时间排序
        segments.sort(Comparator.comparingInt(a -> a[0]));
        
        List<int[]> merged = new ArrayList<>();
        int[] current = segments.get(0).clone();
        
        for (int i = 1; i < segments.size(); i++) {
            int[] next = segments.get(i);
            if (next[0] <= current[1]) {
                // 有重叠，合并到当前区间
                current[1] = Math.max(current[1], next[1]);
            } else {
                // 无重叠，存入当前，开始新区间
                merged.add(current);
                current = next.clone();
            }
        }
        merged.add(current);
        return merged;
    }
}