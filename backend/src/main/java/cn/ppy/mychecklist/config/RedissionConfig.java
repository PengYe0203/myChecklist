package cn.ppy.mychecklist.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.config.SingleServerConfig;
import org.springframework.beans.factory.annotation.Value;

@Configuration
public class RedissionConfig {
    @Value("${spring.redis.host}")
    private String host;

    @Value("${spring.redis.port}")
    private int port;

    @Value("${spring.redis.password:}")
    private String password;

    @Value("${spring.redis.ssl:true}")
    private boolean ssl;

    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        String protocol = ssl ? "rediss://" : "redis://";
        //这里的SingleServer指的是单个Redis节点，不是单个后端服务器
        SingleServerConfig serverConfig = config.useSingleServer()
                .setAddress(protocol + host + ":" + port);
        if (password != null && !password.isEmpty()) {
            serverConfig.setPassword(password);
        }
        return Redisson.create(config);
    }
}
