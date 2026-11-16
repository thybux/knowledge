import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import Challenge from "./components/Challenge.vue";
import Progress from "./components/Progress.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Challenge", Challenge);
    app.component("Progress", Progress);
  },
} satisfies Theme;
