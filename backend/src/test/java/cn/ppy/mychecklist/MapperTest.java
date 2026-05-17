package cn.ppy.mychecklist;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.*;

import cn.ppy.mychecklist.entity.Task;
import cn.ppy.mychecklist.mapper.TaskMapper;

@SpringBootTest
@ActiveProfiles("local")
public class MapperTest {

    @Autowired
    private TaskMapper taskMapper;

    @Test
    void testInsertTask(){
        // new一个task并随便设置NOT NULL的字段
        Task task = new Task();
        task.setTitle("this is a test");
        task.setUserId(1L);

        // 插入数据库
        int result = taskMapper.insert(task);
        assertEquals(1, result); // 插入成功应该返回1
    }
}
