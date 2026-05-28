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
import cn.ppy.mychecklist.service.EmailService;
import cn.ppy.mychecklist.service.UserService;
import cn.ppy.mychecklist.util.Result;
import cn.ppy.mychecklist.util.RedisUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.security.SecureRandom;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private UserService userService;

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    // 生成随机验证码的工具，线程安全
    private static final SecureRandom secureRandom = new SecureRandom();

    @Autowired
    private RedisUtils redisUtils;

    @Autowired
    private EmailService emailService;

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

    @PostMapping("/send-code") // 用户请求发送验证码
    public Result<String> sendCode(@Valid @RequestBody SendCodeRequest req) {
        String email = req.getEmail();
        boolean permit = redisUtils.tryAcquireSendCodePermit(email, 60);
        if (!permit) {
            return Result.error("请勿重复发送，稍后再试");
        }

        int code = 100000 + secureRandom.nextInt(900000); // +100000避免前导0
        String codeStr = String.valueOf(code);
        redisUtils.saveVerifyCode(email, codeStr, 5 * 60); // 有效期5分钟

        try {
            emailService.sendVerificationCode(email, codeStr);
        } catch (Exception ex) { // 发送失败，删除验证码并解锁
            redisUtils.removeVerifyCode(email);
            redisUtils.removeSendCodePermit(email);
            log.error("send verification code email failed, email={}", email, ex);
            return Result.error("验证码发送失败，请稍后重试");
        }

        return Result.success("验证码已发送");
    }

    @PostMapping("/verify-code") // 用户提交验证码进行校验
    public Result<String> verifyCode(@Valid @RequestBody VerifyCodeRequest req) {
        boolean ok = redisUtils.validateVerifyCode(req.getEmail(), req.getCode());
        if (ok) return Result.success("校验通过");
        return Result.error("验证码不正确或已过期");
    }

    @PostMapping("/reset-password-with-code") // 用户提交验证码和新密码进行重置
    public Result<String> resetWithCode(@Valid @RequestBody ResetWithCodeRequest req) {
        boolean ok = redisUtils.validateVerifyCode(req.getEmail(), req.getCode());
        if (!ok) return Result.error("验证码不正确或已过期");
        String response = userService.resetPasswordByEmail(req.getEmail(), req.getNewPassword());
        if(response.contains("失败")) {
            return Result.error(response);
        }
        return Result.success(response);
    }

    @Data // 获取验证码的时候用
    public static class SendCodeRequest {
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        private String email;
    }

    @Data // 校验验证码的时候用
    public static class VerifyCodeRequest {
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        private String email;

        @NotBlank(message = "验证码不能为空")
        private String code;
    }

    @Data // 重置密码的时候用
    public static class ResetWithCodeRequest {
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        private String email;

        @NotBlank(message = "验证码不能为空")
        private String code;

        @NotBlank(message = "新密码不能为空")
        @Size(min = 6, message = "新密码长度必须至少6位")
        private String newPassword;
    }
}