import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import './styles/global.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(ElementPlus);

const authStore = useAuthStore(pinia);
authStore.hydrateFromStorage();

app.mount('#app');
