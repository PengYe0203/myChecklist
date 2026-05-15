package cn.ppy.mychecklist.entity;

import java.time.LocalDate;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
    
@Data
@TableName("review")
public class Review {

    @TableId(type = IdType.AUTO)
    private Long reviewId;

    private Long userId;

    private LocalDate date;

    private String content;
}
