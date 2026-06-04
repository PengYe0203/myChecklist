package cn.ppy.mychecklist.service.impl;

import cn.ppy.mychecklist.entity.Review;
import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.entity.TaskLog;
import cn.ppy.mychecklist.enums.LogResultStatus;
import cn.ppy.mychecklist.mapper.ReviewMapper;
import cn.ppy.mychecklist.mapper.TaskLogMapper;
import cn.ppy.mychecklist.mapper.TaskMapper;
import cn.ppy.mychecklist.model.ReviewAggregateVo;
import cn.ppy.mychecklist.service.ReviewService;
import cn.ppy.mychecklist.component.BloomFilter;
import cn.ppy.mychecklist.util.RedisUtils;
import lombok.extern.slf4j.Slf4j;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

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

@Slf4j
@Service
public class ReviewServiceImpl extends ServiceImpl<ReviewMapper, Review> implements ReviewService {

    @Autowired
    private TaskMapper taskMapper;

    @Autowired
    private TaskLogMapper taskLogMapper;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    @Autowired
    private RedisUtils redisUtils;

    @Autowired
    private BloomFilter bloomFilter;

    private static final String CACHE_KEY_PREFIX = "review:detail:";
    private static final long CACHE_TTL_SECONDS = 86400; // 1天，供用户第二天查看

    private String detailKey(Long userId, LocalDate date) {
        return CACHE_KEY_PREFIX + userId + ":" + date.toString();
    }

    // 每日定时生成前一天的Review，统计当天的任务完成情况和时间分布等数据
    @Override
    @Transactional
    public void generateDailyReport(LocalDate date, Long userId) {
        // 获取该用户在指定日期的所有日志
        List<TaskLog> logs = taskLogMapper.selectList(new LambdaQueryWrapper<TaskLog>()
            .eq(TaskLog::getUserId, userId)
            .eq(TaskLog::getDate, date));

        if (logs.isEmpty()) {
            // 即便没有活跃任务，也要确保清空可能存在的残余执行片段
            clearAllTaskSegments(userId);
            return;
        }

        List<int[]> allSegments = new ArrayList<>(); //所有时间片段，不区分任务
        long grossEffort = 0; //不去重的总时长
        int doneCount = 0; //完成的任务数
        int requiredCount = 0; //需要完成的任务数
        int actualSum = 0; //实际总时长
        int targetSum = 0; //计划总时长

        // 片段格式为 [[s1,e1],[s2,e2]]
        Pattern p = Pattern.compile("\\[(\\d+),(\\d+)\\]");
        
        for (TaskLog taskLog : logs) {
            LogResultStatus status = taskLog.getResultStatus();
            if (status == LogResultStatus.COMPLETED || status == LogResultStatus.LATE_COMPLETED) {
                doneCount++;
            }

            if (status != LogResultStatus.DEFERRED) {
                requiredCount++;
                // 计划总时和实际总时（仅统计需要完成的任务）
                int dailyActual = taskLog.getDailyActualDuration() != null ? taskLog.getDailyActualDuration() : 0;
                // 在今天完成的长周期和ddl任务也会进到这里，因此需要特别处理
                int dailyTarget = calculateDailyTarget(taskLog);
                actualSum += Math.min(dailyActual, dailyTarget);
                targetSum += dailyTarget;
            }

            // 收集并处理时间分布片段
            String segmentsJson = taskLog.getWorkSegments();
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
        if (doneCount == requiredCount && requiredCount > 0) {
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
            review = initReview(date, userId);
        }

        //写入数据
        review.setDoneCount(doneCount);
        review.setTotalCount(requiredCount);
        review.setActualDurationSum(actualSum);
        review.setPlannedDurationSum(targetSum);
        review.setGrossEffort((int) grossEffort);
        review.setNetFocusTime((int) netFocusTime);
        review.setTimeDistribution(distribution);
        review.setStreakDays(streak);
        //存进DB
        this.saveOrUpdate(review);

        //写入Redis和布隆过滤器
        String cacheKey = detailKey(userId, date);
        String json;
        try {
            json = objectMapper.writeValueAsString(review);
            redisUtils.set(cacheKey, json, CACHE_TTL_SECONDS);
        } catch (JsonProcessingException e) {
            log.error("序列化失败, 未写入Redis, userId={}, date={}", userId, date, e);
        }
        bloomFilter.add(BloomFilter.NS_REVIEW, userId + ":" + date.toString());

        // 清空该用户所有任务的片段记录
        clearAllTaskSegments(userId);
    }

    // 对于长周期任务和ddl任务，当天的目标时长为剩余时长
    private int calculateDailyTarget(TaskLog taskLog) {
        int planned = taskLog.getPlannedDuration() == null ? 0 : taskLog.getPlannedDuration();
        int actual = taskLog.getActualDuration() == null ? 0 : taskLog.getActualDuration();
        int dailyActual = taskLog.getDailyActualDuration() == null ? 0 : taskLog.getDailyActualDuration();

        int remaining = planned - Math.max(actual - dailyActual, 0);
        return Math.max(remaining, 0);
    }

    // 把该用户所有的时间片段重置
    private void clearAllTaskSegments(Long userId) {
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

    @Override
    public Review getByDate(LocalDate date, Long currentUserId) {
        // 先查布隆过滤器，快速判断是否可能存在
        if (!bloomFilter.mightContain(BloomFilter.NS_REVIEW, currentUserId + ":" + date.toString())) {
            return null;
        }

        // 从Redis获取
        String cacheKey = detailKey(currentUserId, date);
        String lockKey = "lock:" + cacheKey; //逻辑过期用到的分布式锁

        return redisUtils.getOrRebuild(
                cacheKey, lockKey, CACHE_TTL_SECONDS,
                Review.class,
                () -> {
                    // loader.get()的内容，缓存不存在或过期时执行
                    Review queryResult = this.lambdaQuery()
                            .eq(Review::getUserId, currentUserId)
                            .eq(Review::getDate, date)
                            .one();
                    if(queryResult != null) { // 写入布隆过滤器
                        bloomFilter.add(BloomFilter.NS_REVIEW, currentUserId + ":" + date.toString());
                    }
                    return queryResult;
                });
    }

    @Override
    public List<Review> getAll(Long currentUserId) {
        String cacheKey = "review:list:" + currentUserId;
        String lockKey = "lock:" + cacheKey;

        ReviewListResult result = redisUtils.getOrRebuild(
                cacheKey, lockKey, CACHE_TTL_SECONDS,
                ReviewListResult.class,
                () -> {
                    List<Review> queryResult = this.lambdaQuery()
                            .eq(Review::getUserId, currentUserId)
                            .orderByDesc(Review::getDate)
                            .list();

                    for(Review review : queryResult) {
                        bloomFilter.add(BloomFilter.NS_REVIEW, currentUserId + ":" + review.getDate().toString());
                    }

                    ReviewListResult wrapper = new ReviewListResult();
                    wrapper.reviews = queryResult;
                    return wrapper;
                }
        );

        return result != null ? result.reviews : null;
    }

    @Override
    @Transactional
    public String editReview(LocalDate date, String content, Long currentUserId) {
        Review review;
        
        //布隆过滤器判空
        if (!bloomFilter.mightContain(BloomFilter.NS_REVIEW, currentUserId + ":" + date.toString())) {
            review = initReview(date, currentUserId);
            review.setContent(content);
            boolean saved = this.save(review);
            if (saved) {
                bloomFilter.add(BloomFilter.NS_REVIEW, currentUserId + ":" + date.toString());
            }
            return saved ? "更新成功" : "失败: Review不存在且创建失败";
        }

        // 布隆过滤器判定可能存在
        String cacheKey = detailKey(currentUserId, date);
        String lockKey = "lock:" + cacheKey;
        review = redisUtils.getOrRebuild(
                cacheKey, lockKey, CACHE_TTL_SECONDS,
                Review.class,
                () -> { //缓存不存在或过期时执行
                    Review queryResult = this.lambdaQuery()
                            .eq(Review::getUserId, currentUserId)
                            .eq(Review::getDate, date)
                            .one();
                    if (queryResult == null) {
                        queryResult = initReview(date, currentUserId);
                        this.save(queryResult);
                    }
                    queryResult.setContent(content);
                    return queryResult;
                }
        );
        bloomFilter.add(BloomFilter.NS_REVIEW, currentUserId + ":" + date.toString());

        //前面getOrReubild的set和save是缓存不存在或过期时才执行的
        //所以这里还需要执行一次更新，确保数据库内容被修改
        review.setContent(content);
        return this.updateById(review) ? "更新成功" : "失败: Review存在但更新失败";
    }

    private Review initReview(LocalDate date, Long userId) {
        Review review = new Review();
        review.setUserId(userId);
        review.setDate(date);
        return review;
    }

    @Override
    public ReviewAggregateVo getAggregateReview(LocalDate startDate, LocalDate endDate, Long currentUserId) {
        List<Review> reviews = this.lambdaQuery()
                .eq(Review::getUserId, currentUserId)
                .between(Review::getDate, startDate, endDate)
                .list();

        ReviewAggregateVo aggregate = new ReviewAggregateVo();
        aggregate.setReviewCount(reviews.size());
        if(reviews.isEmpty()) return aggregate;
        
        int doneCount = 0;             // 已完成任务数
        int totalCount = 0;            // 开启的总任务数
        int actualDurationSum = 0;     // 实际总时长（秒）
        int plannedDurationSum = 0;    // 计划总时长（秒）
        int grossEffort = 0;           // 总投入时间（秒）
        int netFocusTime = 0;          // 净专注时间（秒）
        List<LocalDate> activeDistribution = new ArrayList<>();     // 有任务的天数分布
        List<LocalDate> streakDistribution = new ArrayList<>();     // 完成所有任务的天数

        for(Review review: reviews){
            activeDistribution.add(review.getDate());

            int curDone = review.getDoneCount() != null ? review.getDoneCount() : 0;
            int curTotal = review.getTotalCount() != null ? review.getTotalCount() : 0;

            if(curTotal > 0 && curDone == curTotal) streakDistribution.add(review.getDate());
            doneCount += curDone;
            totalCount += curTotal;
            actualDurationSum += review.getActualDurationSum() != null ? review.getActualDurationSum() : 0;
            plannedDurationSum += review.getPlannedDurationSum() != null ? review.getPlannedDurationSum() : 0;
            grossEffort += review.getGrossEffort() != null ? review.getGrossEffort() : 0;
            netFocusTime += review.getNetFocusTime() != null ? review.getNetFocusTime() : 0;

        }

        aggregate.setDoneCount(doneCount);
        aggregate.setTotalCount(totalCount);
        aggregate.setActualDurationSum(actualDurationSum);
        aggregate.setPlannedDurationSum(plannedDurationSum);
        aggregate.setGrossEffort(grossEffort);
        aggregate.setNetFocusTime(netFocusTime);
        aggregate.setActiveDistribution(activeDistribution);
        aggregate.setStreakDistribution(streakDistribution);

        return aggregate;
    }

    @SuppressWarnings("unused")
    private static class ReviewListResult {
        public List<Review> reviews;
    }
}