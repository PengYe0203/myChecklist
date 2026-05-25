package cn.ppy.mychecklist.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum SettlementType {
    MANUAL(0, "手动结算"),
    AUTO(1, "自动结算");

    @EnumValue
    @JsonValue
    private final int code;

    private final String description;

    SettlementType(int code, String description) {
        this.code = code;
        this.description = description;
    }
}
