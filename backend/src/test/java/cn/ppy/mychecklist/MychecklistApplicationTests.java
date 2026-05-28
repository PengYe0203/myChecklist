package cn.ppy.mychecklist;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class MychecklistApplicationTests {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Test
    void testMysqlConnection() {
        String time = jdbcTemplate.queryForObject("SELECT NOW()", String.class);
        // 如果能运行到这一步，说明连接通了。
        // 我们用断言确保 time 不为空，测试通过即代表连接成功。
        org.junit.jupiter.api.Assertions.assertNotNull(time, "数据库返回时间不能为空");
    }

    @Test
    void testRedisConnection() {
        stringRedisTemplate.opsForValue().set("redis:test", "ok");
        String value = stringRedisTemplate.opsForValue().get("redis:test");
        System.out.println(value);
        assert "ok".equals(value);
    }
    
}
