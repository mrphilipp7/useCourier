import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import UploadDemoMount from "./UploadDemoMount.vue";
import "./shadcn.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("UploadDemo", UploadDemoMount);
  },
} satisfies Theme;
