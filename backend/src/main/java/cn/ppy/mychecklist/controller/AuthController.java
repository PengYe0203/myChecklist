package cn.ppy.mychecklist.controller;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;
import cn.ppy.mychecklist.entity.User;
import cn.ppy.mychecklist.service.UserService;
import cn.ppy.mychecklist.util.Result;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private UserService userService;

    @PostMapping("/register")
    public Result<String> register(@Valid @RequestBody User user) {
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

    @PostMapping("/forgot-password")
    public Result<String> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        String response = userService.resetPasswordByEmail(request.getEmail(), request.getNewPassword());
        if(response.contains("失败")) {
            return Result.error(response);
        }
        return Result.success(response);
    }

    @Data
    public static class ForgotPasswordRequest {
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        private String email;

        @NotBlank(message = "新密码不能为空")
        @Size(min = 6, message = "新密码长度必须至少6位")
        private String newPassword;
    }
}