package cn.ppy.mychecklist.service;

import com.baomidou.mybatisplus.extension.service.IService;
import cn.ppy.mychecklist.entity.Review;

public interface ReviewService extends IService<Review> {

    void generateDailyReport(java.time.LocalDate date, Long userId);
}