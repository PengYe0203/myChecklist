package cn.ppy.mychecklist.service;

import com.baomidou.mybatisplus.extension.service.IService;

import cn.ppy.mychecklist.entity.User;

public interface UserService extends IService<User>{

    // 用户注册
    String register(User user);

    // 用户登录，成功则返回JWT token
    String login(String username, String password);

    // 通过邮箱找回密码
    String resetPasswordByEmail(String email, String newPassword);
}
