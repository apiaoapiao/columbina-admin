import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router.ts";
import "./styles.css";

createApp(App).use(router).use(ElementPlus, { locale: zhCn }).mount("#app");
