package cn.ppy.mychecklist.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum RunStatusType {
    NOT_STARTED(0, "未开始"),
    IN_PROGRESS(1, "进行中"),
    PAUSED(2, "暂停");

    @EnumValue
    @JsonValue
    private final int value;

    private final String description;

    RunStatusType(int value, String description) {
        this.value = value;
        this.description = description;
    }
}
