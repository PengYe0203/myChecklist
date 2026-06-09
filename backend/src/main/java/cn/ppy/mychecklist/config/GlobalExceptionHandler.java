package cn.ppy.mychecklist.config;

import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.http.ResponseEntity;

import cn.ppy.mychecklist.util.Result;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<String>> handleException(Exception e) {
        log.error("错误", e);
        return ResponseEntity.internalServerError().body(Result.error("发生错误: " + e.getMessage()));
    }

    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    public ResponseEntity<Result<String>> handleDataIntegrityViolationException(org.springframework.dao.DataIntegrityViolationException e) {
        log.error("数据完整性错误", e);
        return ResponseEntity.badRequest().body(Result.error("错误：请检查输入内容"));
    }
}
