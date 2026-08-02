import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Firebase 與 Vue 佔了絕大部分的體積，而且幾乎不會跟著我們的程式碼一起改版。
        // 拆成獨立 chunk 之後，改自己的程式碼不會讓使用者重新下載整包 vendor。
        //
        // Firebase 一定要整包放同一個 chunk。umbrella 的 `firebase/auth` 只是 re-export，
        // 實作在 `@firebase/auth`；把兩者分到不同 chunk 會造成循環相依，
        // 執行時會噴 "Cannot access 'x' before initialization"。
        // 依 firestore / auth 再細分也沒有好處，它們本來就同版號一起更新。
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const path = id.replace(/\\/g, "/");

          if (/\/node_modules\/@?firebase\//.test(path)) return "firebase";
          if (/\/node_modules\/(@vue\/|vue\/|vue-router\/|pinia\/)/.test(path)) return "vendor-vue";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: false
  },
  preview: {
    port: 4173,
    strictPort: false
  },
  test: {
    // rules 測試要連 emulator，用 npm run test:rules 另外跑。
    include: ["tests/**/*.test.ts"]
  }
});
