package cn.ppy.mychecklist.component;

import org.redisson.api.RBloomFilter;
import org.redisson.api.RedissonClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class BloomFilter {

    public static final String NS_TASK = "task";
    public static final String NS_USER = "user";
    public static final String NS_REVIEW = "review";
    public static final String NS_TASKLOG = "taskLog";

    private static final Logger log = LoggerFactory.getLogger(BloomFilter.class);

    private final RedissonClient redissonClient;

    // 同时管理多个布隆过滤器，key是entity，value是过滤器实例
    private final Map<String, RBloomFilter<String>> filters = new ConcurrentHashMap<>();

    public BloomFilter(RedissonClient redissonClient) {
        this.redissonClient = redissonClient;
    }

    // 根据命名空间获取对应的布隆过滤器实例，首次访问时创建并初始化
    private RBloomFilter<String> filter(String namespace) {
        return filters.computeIfAbsent(namespace, ns -> {
            RBloomFilter<String> f = redissonClient.getBloomFilter("bloom:" + ns);
            boolean ok = f.tryInit(1_000_000L, 0.01); // tryInit 幂等，多次调用不会覆盖已有数据
            log.info("BloomFilter [{}] init {} (expected=1M, fpp=0.01)", ns, ok ? "created" : "reused");
            return f;
        });
    }

    // 判断DB中是否存在这个id
    public boolean mightContain(String namespace, String id) {
        return filter(namespace).contains(id);
    }

    // 新增元素到布隆过滤器
    public void add(String namespace, String id) {
        filter(namespace).add(id);
    }
}
