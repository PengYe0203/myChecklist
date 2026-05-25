package cn.ppy.mychecklist.util;

import java.time.LocalDateTime;
import org.springframework.scheduling.support.CronExpression;

public class CronUtils {


    //根据 Cron 表达式计算相对于某个时间点的“下一次执行时间”
    public static LocalDateTime getNextExecution(String cron, LocalDateTime relativeTime) {
        if(cron == null || cron.isEmpty() || relativeTime == null) return null;
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

