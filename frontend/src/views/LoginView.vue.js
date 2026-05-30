import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { loginApi } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
const router = useRouter();
const authStore = useAuthStore();
const formRef = ref();
const loading = ref(false);
const rememberMe = ref(true);
const form = reactive({
    username: '',
    password: '',
});
const rules = {
    username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
    password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};
const goResetPassword = () => {
    router.push('/reset-password');
};
const goRegister = () => {
    router.push('/register');
};
const handleLogin = async () => {
    if (!formRef.value)
        return;
    await formRef.value.validate(async (valid) => {
        if (!valid)
            return;
        loading.value = true;
        try {
            const response = await loginApi({
                username: form.username.trim(),
                password: form.password,
            });
            const token = response.data || '';
            authStore.login(token, form.username.trim());
            if (!rememberMe.value) {
                sessionStorage.setItem('mychecklist_username', form.username.trim());
            }
            ElMessage.success('登录成功');
            await router.push('/home');
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
    label: "密码",
    prop: "password",
}));
const __VLS_20 = __VLS_19({
    label: "密码",
    prop: "password",
}, ...__VLS_functionalComponentArgsRest(__VLS_19));
__VLS_21.slots.default;
const __VLS_22 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_23 = __VLS_asFunctionalComponent(__VLS_22, new __VLS_22({
    modelValue: (__VLS_ctx.form.password),
    type: "password",
    placeholder: "请输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "current-password",
}));
const __VLS_24 = __VLS_23({
    modelValue: (__VLS_ctx.form.password),
    type: "password",
    placeholder: "请输入密码",
    size: "large",
    clearable: true,
    showPassword: true,
    autocomplete: "current-password",
}, ...__VLS_functionalComponentArgsRest(__VLS_23));
var __VLS_21;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "actions-row" },
});
const __VLS_26 = {}.ElCheckbox;
/** @type {[typeof __VLS_components.ElCheckbox, typeof __VLS_components.elCheckbox, typeof __VLS_components.ElCheckbox, typeof __VLS_components.elCheckbox, ]} */ ;
// @ts-ignore
const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
    modelValue: (__VLS_ctx.rememberMe),
}));
const __VLS_28 = __VLS_27({
    modelValue: (__VLS_ctx.rememberMe),
}, ...__VLS_functionalComponentArgsRest(__VLS_27));
__VLS_29.slots.default;
var __VLS_29;
const __VLS_30 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_31 = __VLS_asFunctionalComponent(__VLS_30, new __VLS_30({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
}));
const __VLS_32 = __VLS_31({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
}, ...__VLS_functionalComponentArgsRest(__VLS_31));
let __VLS_34;
let __VLS_35;
let __VLS_36;
const __VLS_37 = {
    onClick: (__VLS_ctx.goResetPassword)
};
__VLS_33.slots.default;
var __VLS_33;
const __VLS_38 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}));
const __VLS_40 = __VLS_39({
    ...{ 'onClick': {} },
    type: "warning",
    size: "large",
    ...{ class: "submit-btn" },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_39));
let __VLS_42;
let __VLS_43;
let __VLS_44;
const __VLS_45 = {
    onClick: (__VLS_ctx.handleLogin)
};
__VLS_41.slots.default;
var __VLS_41;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "helper-text" },
});
const __VLS_46 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_47 = __VLS_asFunctionalComponent(__VLS_46, new __VLS_46({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
    ...{ class: "helper-link-btn" },
}));
const __VLS_48 = __VLS_47({
    ...{ 'onClick': {} },
    link: true,
    type: "warning",
    ...{ class: "helper-link-btn" },
}, ...__VLS_functionalComponentArgsRest(__VLS_47));
let __VLS_50;
let __VLS_51;
let __VLS_52;
const __VLS_53 = {
    onClick: (__VLS_ctx.goRegister)
};
__VLS_49.slots.default;
var __VLS_49;
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
/** @type {__VLS_StyleScopedClasses['actions-row']} */ ;
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
            rememberMe: rememberMe,
            form: form,
            rules: rules,
            goResetPassword: goResetPassword,
            goRegister: goRegister,
            handleLogin: handleLogin,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
