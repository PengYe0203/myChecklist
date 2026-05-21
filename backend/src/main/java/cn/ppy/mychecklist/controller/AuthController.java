package cn.ppy.mychecklist.controller;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.service.UserService;
import cn.ppy.mychecklist.util.Result;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private UserService userService;

    @PostMapping("/register")
    public Result<String> register(@RequestBody User user) {
        String msg = userService.register(user);
        if(msg.contains("成功")) {
            return Result.success(msg);
        }
        return Result.error(msg);
    }

    @PostMapping("/login")
    public Result<String> login(@RequestBody Map<String, String> loginRequest) {
        String username = loginRequest.get("username");
        String password = loginRequest.get("password");
        String response = userService.login(username, password);
        if(response.contains("失败")) {
            return Result.error(response);
        }
        return Result.success(response);
    }
}