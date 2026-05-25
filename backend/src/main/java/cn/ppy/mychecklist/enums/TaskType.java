package cn.ppy.mychecklist.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum TaskType {
    NOTE(0, "随手记"),
    RECURRING(1, "周期任务"),
    DEADLINE(2, "DDL"),
    SCENE(3, "场景");

    @EnumValue
    @JsonValue
    private final int value;

    private final String description;

    TaskType(int value, String description) {
        this.value = value;
        this.description = description;
    }
}
