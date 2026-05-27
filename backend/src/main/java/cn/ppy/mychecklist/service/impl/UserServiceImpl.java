package cn.ppy.mychecklist.service.impl;

import java.time.LocalDateTime;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;

import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.mapper.UserMapper;
import cn.ppy.mychecklist.service.UserService;
import cn.ppy.mychecklist.util.JwtUtils;

@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtUtils jwtUtils;

    @Override
    public String register(User user) {
        String username = user.getUsername(), password = user.getPassword(),
                email = user.getEmail();

        if(this.query().eq("username", username).count() > 0) { // 用户名查重
            return "注册失败：用户名已存在";
        }else if(username == null) { // 用户名长度检查
            return "注册失败：用户名不能为空";
        }
        if(password == null || password.length() < 6) { // 密码长度检查
            return "注册失败：密码长度必须至少6位";
        }
        user.setPassword(passwordEncoder.encode(password)); // 密码加密
        user.setCreateTime(LocalDateTime.now());
        if(email != null && !email.isEmpty()) user.setEmail(email);
        
        return this.save(user) ? "注册成功" : "注册失败";
    }

    @Override
    public String login(String username, String password) {
        User user = this.query()
                .select("username", "password", "user_id") // 必须显示查询密码，不然不会有密码字段
                .eq("username", username)
                .one();
        if(user == null) return "登录失败：用户不存在";
        if(passwordEncoder.matches(password, user.getPassword())) {
            return jwtUtils.createToken(user.getUserId());
        }else{
            return "登录失败：密码错误";
        }
    }

}
