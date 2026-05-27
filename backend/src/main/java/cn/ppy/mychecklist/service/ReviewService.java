package cn.ppy.mychecklist.service;

import java.time.LocalDate;

import com.baomidou.mybatisplus.extension.service.IService;
import cn.ppy.mychecklist.entity.Review;

public interface ReviewService extends IService<Review> {

    void generateDailyReport(LocalDate date, Long userId);
}