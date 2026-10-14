import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      // echarts 的 package.json 把 lib/chart/*.js 和 lib/component/*.js 全部标成了
      // 「有副作用」，于是即使只 use() 了 K线/柱状/折线，Rollup 也不敢把没用到的
      // 图表（treemap、sankey、gauge…）摇掉，整包被打进产物。
      // 但从 echarts/core、echarts/charts、echarts/components 这些入口导入时，
      // 每个模块只是导出 install 函数，注册完全由 `echarts.use()` 显式驱动，
      // 没有隐式副作用，所以这里可以安全地关掉它们的副作用标记。
      treeshake: {
        moduleSideEffects: (id: string) => !isEchartsModule(id),
      },
      output: {
        // 图表库单独成块，和业务代码分离，改业务时不必让用户重新加载图表库
        manualChunks(id: string) {
          if (isEchartsModule(id)) return "echarts";
          if (id.includes("md-editor-rt")) return "markdown-editor";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});

/** 判断一个模块 id 是否属于 echarts 包 */
function isEchartsModule(id: string): boolean {
  const normalized = id.replace(/\\/g, "/");
  return normalized.includes("/node_modules/echarts/") || normalized.includes("/echarts/lib/");
}