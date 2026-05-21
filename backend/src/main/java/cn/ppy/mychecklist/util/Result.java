package cn.ppy.mychecklist.util;

import lombok.Data;

@Data
public class Result<T> {
    private int code;
    private String message;
    private T data;

    public Result(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public static <T> Result<T> success(T data) {
        return new Result<T>(200, "Success", data);
    }

    public static <T> Result<T> error(String message) {
        return new Result<T>(500, message, null);
    }
}
