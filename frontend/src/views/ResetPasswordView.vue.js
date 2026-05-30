import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { resetPasswordWithCodeApi, sendVerificationCodeApi } from '@/api/auth';
const router = useRouter();
const formRef = ref();
const loading = ref(false);
const sendingCode = ref(false);
const resendCountdown = ref(0);
let countdownTimer = null;
const form = reactive({
    email: '',
    code: '',
    newPassword: '',
    confirmPassword: '',
});
const validateEmail = (_, value, callback) => {
    if (!value) {
        callback(new Error('请输入邮箱'));
        return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(String(value))) {
        callback(new Error('邮箱格式不正确'));
        return;
    }
    callback();
};
const validateConfirm = (_, value, callback) => {
    if (!value) {
        callback(new Error('请确认新密码'));
        return;
    }
    if (String(value) !== form.newPassword) {
        callback(new Error('两次输入的新密码不一致'));
        return;
    }
    callback();
};
const rules = {
    email: [{ validator: validateEmail, trigger: 'blur' }],
    code: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
    newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
    confirmPassword: [{ validator: validateConfirm, trigger: 'blur' }],
};
const startCountdown = (seconds = 60) => {
    if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
    }
    resendCountdown.value = seconds;
    countdownTimer = window.setInterval(() => {
        if (resendCountdown.value <= 1) {
            if (countdownTimer) {
                window.clearInterval(countdownTimer);
                countdownTimer = null;
            }
            resendCountdown.value = 0;
            return;
        }
        resendCountdown.value -= 1;
    }, 1000);
};
onBeforeUnmount(() => {
    if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
    }
});
const handleSendCode = async () => {
    if (!form.email) {
        ElMessage.warning('请先输入邮箱');
        return;
    }
    if (resendCountdown.value > 0) {
        return;
    }
    sendingCode.value = true;
    try {
        const response = await sendVerificationCodeApi({ email: form.email.trim() });
        ElMessage.success(response.data || '验证码已发送，请查收邮箱');
        startCountdown(60);
    }
    catch (error) {
        // http 层会处理错误提示
    }
    finally {
        sendingCode.value = false;
    }
};
const handleReset = async () => {
    if (!formRef.value)
        return;
    await formRef.value.validate(async (valid) => {
        if (!valid)
            return;
        loading.value = true;
        try {
            const response = await resetPasswordWithCodeApi({
                email: form.email.trim(),
                code: form.code.trim(),
                newPassword: form.newPassword,
            });
            ElMessage.success(response.data || '密码重置成功');
            await router.push('/login');
        }
        catch (error) {
            // http 层会处理错误提示
        }
        finally {
            loading.value = false;
        }
    });
};
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['card-head']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-page']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-head']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "reset-page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "reset-card-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "reset-card-glow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "reset-card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "card-topbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "status-dot" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "card-head" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "eyebrow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "subline" },
});
const __VLS_0 = {}.ElForm;
/** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onSubmit': {} },
    ref: "formRef",
    model: (__VLS_ctx.form),
    rules: (__VLS_ctx.rules),
    ...{ class: "reset-form" },
    labelPosition: "top",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onSubmit': {} },
    ref: "formRef",
    model: (__VLS_ctx.form),
    rules: (__VLS_ctx.rules),
    ...{ class: "reset-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onSubmit: () => { }
};
/** @type {typeof __VLS_ctx.formRef} */ ;
var __VLS_8 = {};
__VLS_3.slots.default;
const __VLS_10 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_11 = __VLS_asFunctionalComponent(__VLS_10, new __VLS_10({
    label: "邮箱",
    prop: "email",
}));
const __VLS_12 = __VLS_11({
    label: "邮箱",
    prop: "email",
}, ...__VLS_functionalComponentArgsRest(__VLS_11));
__VLS_13.slots.default;
const __VLS_14 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_15 = __VLS_asFunctionalComponent(__VLS_14, new __VLS_14({
    modelValue: (__VLS_ctx.form.email),
    placeholder: "请输入注册邮箱",
    size: "large",
    clearable: true,
    autocomplete: "email",
}));
const __VLS_16 = __VLS_15({
    modelValue: (__VLS_ctx.form.email),
    placeholder: "请输入注册邮箱",
    size: "large",
    clearable: true,
    autocomplete: "email",
}, ...__VLS_functionalComponentArgsRest(__VLS_15));
__VLS_17.slots.default;
{
    const { append: __VLS_thisSlot } = __VLS_17.slots;
    const __VLS_18 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_19 = __VLS_asFunctionalComponent(__VLS_18, new __VLS_18({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.sendingCode),
        disabled: (__VLS_ctx.resendCountdown > 0),
    }));
    const __VLS_20 = __VLS_19({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.sendingCode),
        disabled: (__VLS_ctx.resendCountdown > 0),
    }, ...__VLS_functionalComponentArgsRest(__VLS_19));
    let __VLS_22;
    let __VLS_23;
    let __VLS_24;
    const __VLS_25 = {
        onClick: (__VLS_ctx.handleSendCode)
    };
    __VLS_21.slots.default;
    (__VLS_ctx.resendCountdown > 0 ? `${__VLS_ctx.resendCountdown}s 后重发` : '发送验证码');
    var __VLS_21;
}
var __VLS_17;
var __VLS_13;
const __VLS_26 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
    label: "验证码",
    prop: "code",
}));
const __VLS_28 = __VLS_27({
    label: "验证码",
    prop: "code",
}, ...__VLS_functionalComponentArgsRest(__VLS_27));
__VLS_29.slots.default;
const __VLS_30 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_31 = __VLS_asFunctionalComponent(__VLS_30, new __VLS_30({
    modelValue: (__VLS_ctx.form.code),
    placeholder: "请输入 6 位验证码",
    size: "large",
    clearable: true,
    maxlength: "6",
    autocomplete: "one-time-code",
}));
const __VLS_32 = __VLS_31({
    modelValue: (__VLS_ctx.form.code),
    placeholder: "请输入 6 位验证码",
    size: "large",
    clearable: true,
    maxlength: "6",
    autocomplete: "one-time-code",
}, ...__VLS_functionalComponentArgsRest(__VLS_31));
var __VLS_29;
const __VLS_34 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_35 = __VLS_asFunctionalComponent(__VLS_34, new __VLS_34({
    label: "新密码",
    prop: "newPassword",
}));
const __VLS_36 = __VLS_35({
    label: "新密码",
    prop: "newPassword",
}, ...__VLS_functionalComponentArgsRest(__VLS_35));
__VLS_37.slots.default;
const __VLS_38 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
    modelValue: (__VLS_ctx.form.newPassword),
    type: "password",
    placeholder: "请输入新密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}));
const __VLS_40 = __VLS_39({
    modelValue: (__VLS_ctx.form.newPassword),
    type: "password",
    placeholder: "请输入新密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}, ...__VLS_functionalComponentArgsRest(__VLS_39));
var __VLS_37;
const __VLS_42 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_43 = __VLS_asFunctionalComponent(__VLS_42, new __VLS_42({
    label: "确认新密码",
    prop: "confirmPassword",
}));
const __VLS_44 = __VLS_43({
    label: "确认新密码",
    prop: "confirmPassword",
}, ...__VLS_functionalComponentArgsRest(__VLS_43));
__VLS_45.slots.default;
const __VLS_46 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_47 = __VLS_asFunctionalComponent(__VLS_46, new __VLS_46({
    modelValue: (__VLS_ctx.form.confirmPassword),
    type: "password",
    placeholder: "请再次输入新密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}));
const __VLS_48 = __VLS_47({
    modelValue: (__VLS_ctx.form.confirmPassword),
    type: "password",
    placeholder: "请再次输入新密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}, ...__VLS_functionalComponentArgsRest(__VLS_47));
var __VLS_45;
const __VLS_50 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_51 = __VLS_asFunctionalComponent(__VLS_50, new __VLS_50({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}));
const __VLS_52 = __VLS_51({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_51));
let __VLS_54;
let __VLS_55;
let __VLS_56;
const __VLS_57 = {
    onClick: (__VLS_ctx.handleReset)
};
__VLS_53.slots.default;
var __VLS_53;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "helper-text" },
});
const __VLS_58 = {}.RouterLink;
/** @type {[typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, typeof __VLS_components.RouterLink, typeof __VLS_components.routerLink, ]} */ ;
// @ts-ignore
const __VLS_59 = __VLS_asFunctionalComponent(__VLS_58, new __VLS_58({
    to: "/login",
}));
const __VLS_60 = __VLS_59({
    to: "/login",
}, ...__VLS_functionalComponentArgsRest(__VLS_59));
__VLS_61.slots.default;
var __VLS_61;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['reset-page']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-card-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-card-glow']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['card-head']} */ ;
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['subline']} */ ;
/** @type {__VLS_StyleScopedClasses['reset-form']} */ ;
/** @type {__VLS_StyleScopedClasses['submit-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['helper-text']} */ ;
// @ts-ignore
var __VLS_9 = __VLS_8;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            formRef: formRef,
            loading: loading,
            sendingCode: sendingCode,
            resendCountdown: resendCountdown,
            form: form,
            rules: rules,
            handleSendCode: handleSendCode,
            handleReset: handleReset,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
