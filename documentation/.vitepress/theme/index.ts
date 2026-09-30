import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { defineComponent, h } from "vue";
import type { ComponentType } from "react";
import ReactDemoMount from "./ReactDemoMount.vue";
import { UploadDemo } from "./UploadDemo.js";
import { LifecycleDemo } from "./LifecycleDemo.js";
import "./shadcn.css";

/** Registers a React demo as a Vue component usable directly in markdown. */
function reactDemo(component: ComponentType) {
  return defineComponent({
    setup: () => () => h(ReactDemoMount, { component }),
  });
}

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("UploadDemo", reactDemo(UploadDemo));
    app.component("LifecycleDemo", reactDemo(LifecycleDemo));
  },
} satisfies Theme;
