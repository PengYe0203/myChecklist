package cn.ppy.mychecklist.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum LogResultStatus {
    NOT_STARTED(0, "未开始"),
    NOT_COMPLETED(1, "未完成"),
    COMPLETED(2, "完成"),
    LATE_COMPLETED(3, "超时完成"),
    DEFERRED(4, "暂不要求完成");

    @EnumValue
    @JsonValue
    private final int value;

    private final String description;

    LogResultStatus(int value, String description) {
        this.value = value;
        this.description = description;
    }
}
