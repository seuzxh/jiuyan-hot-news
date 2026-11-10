import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  ssr: {
    // 工作区包导出 .ts 源码，需经 vite 转换（node:sqlite 等 builtin 保持 external）
    noExternal: [/^@jyc\//],
  },
});
