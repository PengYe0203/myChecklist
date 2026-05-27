package cn.ppy.mychecklist.controller;

import java.time.LocalDate;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.ppy.mychecklist.entity.Review;
import cn.ppy.mychecklist.service.ReviewService;
import cn.ppy.mychecklist.util.Result;

@RestController
@RequestMapping("/api/reviews")
public class ReviewController {

    @Autowired
    private ReviewService reviewService;

    // 获取当前登录用户 ID，与 TaskController 保持一致
    private Long getCurrentUserId() {
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    @GetMapping("/all")
    public Result<List<Review>> getAllReviews() {
        List<Review> reviews = reviewService.getAll(getCurrentUserId());
        return Result.success(reviews);
    }

    @GetMapping
    public Result<Review> getByDate(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        Review review = reviewService.getByDate(date, getCurrentUserId());
        if (review != null) {
            return Result.success(review);
        } else {
            return Result.error("未找到该日期的复盘");
        }
    }

    @PostMapping("/edit")
    public Result<String> editReview(@RequestBody String content, 
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        String msg = reviewService.editReview(date, content, getCurrentUserId());
        if(msg.contains("成功")) {
            return Result.success(msg);
        }else{
            return Result.error(msg);
        }  
    }
}
