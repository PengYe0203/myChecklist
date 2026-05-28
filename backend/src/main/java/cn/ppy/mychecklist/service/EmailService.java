package cn.ppy.mychecklist.service;

public interface EmailService {

    void sendVerificationCode(String to, String code);
}