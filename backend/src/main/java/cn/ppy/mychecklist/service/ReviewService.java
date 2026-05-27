package cn.ppy.mychecklist.service;

import java.time.LocalDate;
import java.util.List;

import com.baomidou.mybatisplus.extension.service.IService;
import cn.ppy.mychecklist.entity.Review;
import cn.ppy.mychecklist.model.ReviewAggregateVo;

public interface ReviewService extends IService<Review> {

    void generateDailyReport(LocalDate date, Long userId);

    Review getByDate(LocalDate date, Long currentUserId);

    List<Review> getAll(Long currentUserId);

    String editReview(LocalDate date, String content, Long currentUserId);

    ReviewAggregateVo getAggregateReview(LocalDate startDate, LocalDate endDate, Long currentUserId);
}