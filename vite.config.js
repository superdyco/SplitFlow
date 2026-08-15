import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

/**
 * 使用者回報問題時第一個要問的是「你跑的是哪一版」。
 *
 * 這個問題在這裡特別重要：index.html 有一小時快取而且刻意不做 service worker，
 * 所以「他在跑舊版」是真的會發生、而且從外面完全看不出來的狀況。
 * commit 短碼加上建置時間，貼在診斷資訊的第一行。
 */
function buildVersion() {
  let sha = "unknown";
  try {
    sha = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
  } catch {
    // 沒有 git、或從 tarball 解出來的環境照樣要建得起來，版本就寫 unknown。
  }

  // 本機時間而不是 UTC：讀這個字串的是剛剛按下 deploy 的人，差八小時只會讓他
  // 懷疑自己看到的是舊的那一版。
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return `${sha} ${at}`;
}

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion())
  },
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
        // 不能拆的是「同一個產品的 umbrella 與實作」：`firebase/auth` 只是 re-export，
        // 實作在 `@firebase/auth`，兩者分到不同 chunk 會成環，執行時噴
        // "Cannot access 'x' before initialization"。整個產品一起搬走則是單向依賴，沒問題。
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const path = id.replace(/\\/g, "/");

          // storage 只有收據功能用得到，而且是動態載入的。跟其他 firebase 綁在一起的話，
          // 沒碰過收據的人也要在首屏付這個體積。umbrella 與實作一起搬，所以不會成環 ——
          // 寫錯了 check-chunks 會在 build 時擋下來。
          if (/\/node_modules\/@?firebase\/storage\//.test(path)) return "firebase-storage";

          // auth 與 firestore 首屏就要，而且本來就同版號一起更新，再細分沒有好處。
          if (/\/node_modules\/@?firebase\//.test(path)) return "firebase";
          if (/\/node_modules\/(@vue\/|vue\/|vue-router\/|pinia\/)/.test(path)) return "vendor-vue";

          // chart.js 只有結算頁的分類圖表用得到，而且是動態載入的。
          // 不獨立成 chunk 的話會被歸進 vendor，那個是首屏就載的，
          // 等於沒點開結算頁的人也要付這個體積。@kurkle/color 是它的相依。
          if (/\/node_modules\/(chart\.js|@kurkle\/color)\//.test(path)) return "chart";

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
