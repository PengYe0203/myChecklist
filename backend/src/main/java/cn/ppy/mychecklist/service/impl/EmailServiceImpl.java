package cn.ppy.mychecklist.service.impl;

import cn.ppy.mychecklist.service.EmailService;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

@Service
public class EmailServiceImpl implements EmailService {

    private final JavaMailSender javaMailSender;
    private final String mailFrom;

    public EmailServiceImpl(JavaMailSender javaMailSender,
                            @Value("${spring.mail.username}") String mailFrom) {
        this.javaMailSender = javaMailSender;
        this.mailFrom = mailFrom;
    }

    @Override
    public void sendVerificationCode(String to, String code) {
        MimeMessage message = javaMailSender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(to);
            helper.setSubject("MyChecklist 验证码");
            helper.setText(buildVerificationCodeHtml(code), true);
            javaMailSender.send(message);
        } catch (MessagingException e) {
            throw new IllegalStateException("验证码邮件发送失败", e);
        }
    }

    private String buildVerificationCodeHtml(String code) {
        return "<div style='font-family:Arial,sans-serif;line-height:1.6'>"
                + "<h2>MyChecklist 验证码</h2>"
                + "<p>你的验证码是：<strong style='font-size:24px'>" + code + "</strong></p>"
                + "<p>验证码 5 分钟内有效，请勿泄露给他人。</p>"
                + "</div>";
    }
}