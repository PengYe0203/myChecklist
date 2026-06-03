package cn.ppy.mychecklist.util;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import cn.ppy.mychecklist.component.BloomFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.ReturnType;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * Redis 工具类
 * 管理 key 前缀、TTL 与常用原子操作
 */
@Component
public class RedisUtils {
    private static final Logger log = LoggerFactory.getLogger(RedisUtils.class);

    private final StringRedisTemplate stringRedisTemplate;
    private final BloomFilter bloomFilter;

    private static final String KEY_VERIFY_CODE = "verify:email:%s";
    private static final String KEY_SEND_LIMIT = "limit:send-code:%s";

    /** TTL 随机抖动的比例，±20% */
    private static final double JITTER_RATIO = 0.2;

    public RedisUtils(StringRedisTemplate stringRedisTemplate,
                      BloomFilter bloomFilter) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.bloomFilter = bloomFilter;
    }

    // 为ttl增加抖动，防止大量key在同一时间过期导致缓存雪崩
    // ThreadLocalRandom是适合多线程环境的随机数生成器
    private long jitter(long ttlSeconds) {
        if (ttlSeconds <= 5) return ttlSeconds;
        long delta = (long) (ttlSeconds * JITTER_RATIO);
        long offset = ThreadLocalRandom.current().nextLong(-delta, delta + 1);
        return Math.max(1, ttlSeconds + offset);
    }

    public void set(String key, String value, long ttlSeconds) {
        if (ttlSeconds > 0) {
            stringRedisTemplate.opsForValue().set(key, value, Duration.ofSeconds(jitter(ttlSeconds)));
        } else {
            stringRedisTemplate.opsForValue().set(key, value);
        }
    }

    public String get(String key) {
        return stringRedisTemplate.opsForValue().get(key);
    }

    public boolean delete(String key) {
        Boolean res = stringRedisTemplate.delete(key);
        return Boolean.TRUE.equals(res);
    }

    public boolean exists(String key) {
        Boolean res = stringRedisTemplate.hasKey(key);
        return Boolean.TRUE.equals(res);
    }

    public long increment(String key, long delta) {
        Long res = stringRedisTemplate.opsForValue().increment(key, delta);
        return res == null ? 0L : res;
    }

    public boolean setIfAbsent(String key, String value, long ttlSeconds) {
        if (ttlSeconds > 0) {
            Boolean res = stringRedisTemplate.opsForValue().setIfAbsent(key, value, Duration.ofSeconds(jitter(ttlSeconds)));
            return Boolean.TRUE.equals(res);
        }
        Boolean res = stringRedisTemplate.opsForValue().setIfAbsent(key, value);
        return Boolean.TRUE.equals(res);
    }

    public void expire(String key, long ttlSeconds) {
        stringRedisTemplate.expire(key, Duration.ofSeconds(jitter(ttlSeconds)));
    }

    // 负责Java对象和Json的相互转换
    private final ObjectMapper objectMapper = new ObjectMapper();

    // data是实际数据，putAtMillis是放入缓存的时间戳，用于逻辑过期判断
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class CacheWrapper {
        public Object data;
        public long putAtMillis;
    }

    // 带逻辑过期的缓存获取，适用于热点数据
    public <T> T getOrRebuild(String key, String lockKey, long logicalTtlSeconds,
                              Class<T> clazz, Supplier<T> loader) {

        String cached = get(key);
        CacheWrapper wrapper = null;

        if (cached != null) {
            try {
                wrapper = objectMapper.readValue(cached, CacheWrapper.class);
            } catch (JsonProcessingException e) {
                log.error("getOrRebuild deserialize wrapper failed. key={}", key, e);
            }
        }

        // 缓存不存在，则加锁、访问DB、创建缓存
        if (wrapper == null || wrapper.data == null) {
            boolean locked = setIfAbsent(lockKey, "1", 10);
            if (locked) { // 成功拿到锁，重建后放入缓存
                try {
                    T value = loader.get();
                    if (value != null) {
                        CacheWrapper w = new CacheWrapper();
                        w.data = value;
                        w.putAtMillis = System.currentTimeMillis();
                        try {
                            set(key, objectMapper.writeValueAsString(w), logicalTtlSeconds * 5);
                        } catch (JsonProcessingException e) {
                            log.error("getOrRebuild initial serialize failed. key={}", key, e);
                        }
                    }
                    return value;
                } finally {
                    delete(lockKey);
                }
            }
            // 无缓存且未拿到锁，直接查询DB并返回
            return loader.get();
        }

        // 缓存存在，读取数据进value
        T value;
        try {
            value = objectMapper.convertValue(wrapper.data, clazz); // 把json转换回对象
        } catch (Exception e) {
            log.error("getOrRebuild convertValue failed. key={}", key, e);
            return loader.get();
        }

        // 判断是否逻辑过期
        long ageMillis = System.currentTimeMillis() - wrapper.putAtMillis;
        if (ageMillis > logicalTtlSeconds * 1000L) {
            // 逻辑过期，加锁并重建缓存
            final String fKey = key;
            final String fLockKey = lockKey;
            final long fTtl = logicalTtlSeconds;
            final Supplier<T> fLoader = loader;
            //异步重建，不阻塞当前请求
            CompletableFuture.runAsync(() -> {
                boolean locked = setIfAbsent(fLockKey, "1", 10);
                if (!locked) return;
                try {
                    T fresh = fLoader.get();
                    if (fresh != null) {
                        CacheWrapper w = new CacheWrapper();
                        w.data = fresh;
                        w.putAtMillis = System.currentTimeMillis();
                        try {
                            set(fKey, objectMapper.writeValueAsString(w), fTtl * 5);
                        } catch (JsonProcessingException ex) {
                            log.error("getOrRebuild async serialize failed. key={}", fKey, ex);
                        }
                    }
                } finally {
                    delete(fLockKey);
                }
            });
        }

        // 无论是否过期，都返回
        return value;
    }

    // 存邮箱验证码并设置ttl
    public void saveVerifyCode(String email, String code, long ttlSeconds) {
        String key = String.format(KEY_VERIFY_CODE, email);
        set(key, code, ttlSeconds);
    }

    // 删除邮箱验证码，邮件发送失败时调用
    public void removeVerifyCode(String email) {
        String key = String.format(KEY_VERIFY_CODE, email);
        delete(key);
    }

    // 校验并删除邮箱验证码
    // 把操作写成Lua脚本形式，整个脚本会被视为一个原子操作
    public boolean validateVerifyCode(String email, String code) {
        if (email == null || code == null) return false;
        String key = String.format(KEY_VERIFY_CODE, email);
        byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
        byte[] valBytes = code.getBytes(StandardCharsets.UTF_8);
        final byte[] script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end".getBytes(StandardCharsets.UTF_8);

        try {
            Long result = stringRedisTemplate.execute((RedisCallback<Long>) connection ->
                    connection.eval(script, ReturnType.INTEGER, 1, keyBytes, valBytes)
            );
            return Objects.equals(result, 1L);
        } catch (DataAccessException e) {
            log.error("validateVerifyCode redis exec failed", e);
            return false;
        }
    }

    // 尝试获取验证码，如果获取成功则写入并设置一个cd，防止频繁获取
    public boolean tryAcquireSendCodePermit(String email, long cooldownSeconds) {
        String key = String.format(KEY_SEND_LIMIT, email);
        return setIfAbsent(key, "1", cooldownSeconds);
    }

    // 移除验证码，避免被重复使用
    public void removeSendCodePermit(String email) {
        String key = String.format(KEY_SEND_LIMIT, email);
        delete(key);
    }

}
