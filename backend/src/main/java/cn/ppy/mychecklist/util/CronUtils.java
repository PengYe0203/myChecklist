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

        DayIntervalRule dayIntervalRule = parseDayInterval(cron);
        if (dayIntervalRule != null) {
            if (relativeTime.isBefore(dayIntervalRule.anchorTime)) {
                return dayIntervalRule.anchorTime;
            }

            long passedDays = Duration.between(dayIntervalRule.anchorTime, relativeTime).toDays();
            long nextOffsetDays = ((passedDays / dayIntervalRule.stepDays) + 1) * (long) dayIntervalRule.stepDays;
            return dayIntervalRule.anchorTime.plusDays(nextOffsetDays);
        }

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
}

