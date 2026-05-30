import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { registerApi } from '@/api/auth';
const router = useRouter();
const formRef = ref();
const loading = ref(false);
const form = reactive({
    username: '',
    email: '',
    password: '',
    confirm: '',
});
const validateEmail = (_, value, callback) => {
    if (!value) {
        callback();
        return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(String(value))) {
        callback(new Error('邮箱格式不正确'));
        return;
    }
    callback();
};
const rules = {
    username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
    email: [{ validator: validateEmail, trigger: 'blur' }],
    password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
    confirm: [{ required: true, message: '请确认密码', trigger: 'blur' }],
};
const goLogin = () => {
    router.push('/login');
};
const handleRegister = async () => {
    if (!formRef.value)
        return;
    await formRef.value.validate(async (valid) => {
        if (!valid)
            return;
        if (form.password !== form.confirm) {
            ElMessage.error('两次输入的密码不一致');
            return;
        }
        loading.value = true;
        try {
            const payload = {
                username: form.username.trim(),
                password: form.password,
                email: form.email?.trim() || undefined,
            };
            const res = await registerApi(payload);
            ElMessage.success(res.data || '注册成功');
            await router.push('/login');
        }
        catch (err) {
            // http 库会显示消息
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
/** @type {__VLS_StyleScopedClasses['login-page']} */ ;
/** @type {__VLS_StyleScopedClasses['login-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-head']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-card-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-card-glow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "login-card" },
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
const __VLS_0 = {}.ElForm;
/** @type {[typeof __VLS_components.ElForm, typeof __VLS_components.elForm, typeof __VLS_components.ElForm, typeof __VLS_components.elForm, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onSubmit': {} },
    ref: "formRef",
    model: (__VLS_ctx.form),
    rules: (__VLS_ctx.rules),
    ...{ class: "login-form" },
    labelPosition: "top",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onSubmit': {} },
    ref: "formRef",
    model: (__VLS_ctx.form),
    rules: (__VLS_ctx.rules),
    ...{ class: "login-form" },
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
    label: "用户名",
    prop: "username",
}));
const __VLS_12 = __VLS_11({
    label: "用户名",
    prop: "username",
}, ...__VLS_functionalComponentArgsRest(__VLS_11));
__VLS_13.slots.default;
const __VLS_14 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_15 = __VLS_asFunctionalComponent(__VLS_14, new __VLS_14({
    modelValue: (__VLS_ctx.form.username),
    placeholder: "请输入用户名",
    size: "large",
    clearable: true,
    autocomplete: "username",
}));
const __VLS_16 = __VLS_15({
    modelValue: (__VLS_ctx.form.username),
    placeholder: "请输入用户名",
    size: "large",
    clearable: true,
    autocomplete: "username",
}, ...__VLS_functionalComponentArgsRest(__VLS_15));
var __VLS_13;
const __VLS_18 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_19 = __VLS_asFunctionalComponent(__VLS_18, new __VLS_18({
    label: "邮箱 (可选)",
    prop: "email",
}));
const __VLS_20 = __VLS_19({
    label: "邮箱 (可选)",
    prop: "email",
}, ...__VLS_functionalComponentArgsRest(__VLS_19));
__VLS_21.slots.default;
const __VLS_22 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_23 = __VLS_asFunctionalComponent(__VLS_22, new __VLS_22({
    modelValue: (__VLS_ctx.form.email),
    placeholder: "请输入邮箱",
    size: "large",
    clearable: true,
    autocomplete: "email",
}));
const __VLS_24 = __VLS_23({
    modelValue: (__VLS_ctx.form.email),
    placeholder: "请输入邮箱",
    size: "large",
    clearable: true,
    autocomplete: "email",
}, ...__VLS_functionalComponentArgsRest(__VLS_23));
var __VLS_21;
const __VLS_26 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
    label: "密码",
    prop: "password",
}));
const __VLS_28 = __VLS_27({
    label: "密码",
    prop: "password",
}, ...__VLS_functionalComponentArgsRest(__VLS_27));
__VLS_29.slots.default;
const __VLS_30 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_31 = __VLS_asFunctionalComponent(__VLS_30, new __VLS_30({
    modelValue: (__VLS_ctx.form.password),
    type: "password",
    placeholder: "请输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}));
const __VLS_32 = __VLS_31({
    modelValue: (__VLS_ctx.form.password),
    type: "password",
    placeholder: "请输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}, ...__VLS_functionalComponentArgsRest(__VLS_31));
var __VLS_29;
const __VLS_34 = {}.ElFormItem;
/** @type {[typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, typeof __VLS_components.ElFormItem, typeof __VLS_components.elFormItem, ]} */ ;
// @ts-ignore
const __VLS_35 = __VLS_asFunctionalComponent(__VLS_34, new __VLS_34({
    label: "确认密码",
    prop: "confirm",
}));
const __VLS_36 = __VLS_35({
    label: "确认密码",
    prop: "confirm",
}, ...__VLS_functionalComponentArgsRest(__VLS_35));
__VLS_37.slots.default;
const __VLS_38 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
    modelValue: (__VLS_ctx.form.confirm),
    type: "password",
    placeholder: "请再次输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}));
const __VLS_40 = __VLS_39({
    modelValue: (__VLS_ctx.form.confirm),
    type: "password",
    placeholder: "请再次输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "new-password",
}, ...__VLS_functionalComponentArgsRest(__VLS_39));
var __VLS_37;
const __VLS_42 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_43 = __VLS_asFunctionalComponent(__VLS_42, new __VLS_42({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}));
const __VLS_44 = __VLS_43({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_43));
let __VLS_46;
let __VLS_47;
let __VLS_48;
const __VLS_49 = {
    onClick: (__VLS_ctx.handleRegister)
};
__VLS_45.slots.default;
var __VLS_45;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "helper-text" },
});
const __VLS_50 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_51 = __VLS_asFunctionalComponent(__VLS_50, new __VLS_50({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
    ...{ class: "helper-link-btn" },
}));
const __VLS_52 = __VLS_51({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
    ...{ class: "helper-link-btn" },
}, ...__VLS_functionalComponentArgsRest(__VLS_51));
let __VLS_54;
let __VLS_55;
let __VLS_56;
const __VLS_57 = {
    onClick: (__VLS_ctx.goLogin)
};
__VLS_53.slots.default;
var __VLS_53;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['login-page']} */ ;
/** @type {__VLS_StyleScopedClasses['login-card-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['login-card-glow']} */ ;
/** @type {__VLS_StyleScopedClasses['login-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['card-head']} */ ;
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['login-form']} */ ;
/** @type {__VLS_StyleScopedClasses['submit-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['helper-text']} */ ;
/** @type {__VLS_StyleScopedClasses['helper-link-btn']} */ ;
// @ts-ignore
var __VLS_9 = __VLS_8;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            formRef: formRef,
            loading: loading,
            form: form,
            rules: rules,
            goLogin: goLogin,
            handleRegister: handleRegister,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
