package cn.ppy.mychecklist.util;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.scheduling.support.CronExpression;

public class CronUtils {

    private static final Pattern EVERY_DAYS_PATTERN = Pattern.compile("^DAY_INTERVAL\\|(\\d+)\\|([0-9T:\\-]+)$");

    private static class DayIntervalRule {
        private final int stepDays;
        private final LocalDateTime anchorTime;

        private DayIntervalRule(int stepDays, LocalDateTime anchorTime) {
            this.stepDays = stepDays;
            this.anchorTime = anchorTime;
        }
    }

    private static DayIntervalRule parseDayInterval(String cron) {
        if (cron == null || cron.isEmpty()) return null;

        Matcher matcher = EVERY_DAYS_PATTERN.matcher(cron.trim().toUpperCase());
        if (!matcher.matches()) return null;

        int stepDays = Integer.parseInt(matcher.group(1));
        if (stepDays < 1) return null;

        try {
            LocalDateTime anchorTime = LocalDateTime.parse(matcher.group(2));
            return new DayIntervalRule(stepDays, anchorTime);
        } catch (Exception e) {
            return null;
        }
    }


    //根据 Cron 表达式计算相对于某个时间点的“下一次执行时间”
    public static LocalDateTime getNextExecution(String cron, LocalDateTime relativeTime) {
        if(cron == null || cron.isEmpty() || relativeTime == null) return null;

        // 首先尝试解析自定义的“每N天”规则
        DayIntervalRule dayIntervalRule = parseDayInterval(cron);
        if (dayIntervalRule != null) {
            if (relativeTime.isBefore(dayIntervalRule.anchorTime)) {
                return dayIntervalRule.anchorTime;
            }

            long passedDays = Duration.between(dayIntervalRule.anchorTime, relativeTime).toDays();
            long nextOffsetDays = ((passedDays / dayIntervalRule.stepDays) + 1) * (long) dayIntervalRule.stepDays;
            return dayIntervalRule.anchorTime.plusDays(nextOffsetDays);
        }

        // 标准Cron表达式解析
        try {
            CronExpression expression = CronExpression.parse(cron);
            return expression.next(relativeTime);
        } catch (Exception e) {
            return null;
        }
    }

    //判断是否要刷新
    public static boolean isExpired(String cron, LocalDateTime cycleStartRef) {
        if (cron == null || cycleStartRef == null) return false;
        
        LocalDateTime nextTime = getNextExecution(cron, cycleStartRef); //下一个周期的开始时间
        return nextTime != null && !LocalDateTime.now().isBefore(nextTime);
    }

    /**
     * 获取当前周期的开始时间（&lt;= now 的最新一次执行）。
     * 例如每天 4:00，now=今天10:00 → 返回今天 4:00。
     */
    public static LocalDateTime getCurrentCycleStart(String cron, LocalDateTime now) {
        if(cron == null || cron.isEmpty() || now == null) return null;

        DayIntervalRule dayIntervalRule = parseDayInterval(cron);
        if (dayIntervalRule != null) {
            if (now.isBefore(dayIntervalRule.anchorTime)) return null; // 尚未开始

            long passedDays = Duration.between(dayIntervalRule.anchorTime, now).toDays();
            long currentOffsetDays = (passedDays / dayIntervalRule.stepDays) * (long) dayIntervalRule.stepDays;
            return dayIntervalRule.anchorTime.plusDays(currentOffsetDays);
        }

        try {
            CronExpression expression = CronExpression.parse(cron);
            // 标准 cron：从足够早的时间开始，一步步向前找到 &lt;= now 的最新执行
            LocalDateTime cursor = now.minusYears(1);
            LocalDateTime result = null;
            while (cursor != null && !cursor.isAfter(now)) {
                result = cursor;
                cursor = expression.next(cursor);
            }
            return result;
        } catch (Exception e) {
            return null;
        }
    }
}

