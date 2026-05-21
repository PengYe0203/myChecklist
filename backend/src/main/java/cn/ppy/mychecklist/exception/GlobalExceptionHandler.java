package cn.ppy.mychecklist.exception;

import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;

import cn.ppy.mychecklist.util.Result;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public Result<String> handleException(Exception e) {
        log.error("错误", e);
        return Result.error("发生错误: " + e.getMessage());
    }

    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    public Result<String> handleDataIntegrityViolationException(org.springframework.dao.DataIntegrityViolationException e) {
        log.error("数据完整性错误", e);
        return Result.error("错误：请检查输入内容");
    }
}
