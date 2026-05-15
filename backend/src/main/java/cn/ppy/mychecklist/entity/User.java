package cn.ppy.mychecklist.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import jakarta.validation.constraints.Email;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long userId;

    private String username;

    @TableField(value = "password", select = false)
    private String password;

    @Email(message = "邮箱格式不正确")
    private String email;

    private LocalDateTime createTime;

}
