import { defineConfig } from "vitest/config";

/**
 * 測試放在 `src/` 裡跟被測的檔案並排，而不是另開 `tests/`。
 *
 * 這個專案很小（只有觸發器跟它需要的幾支純函式），並排看得到誰對應誰。
 * vitest 預設只找 `tests/**`，所以要明講。
 *
 * `tsconfig.json` 的 `exclude` 已經把 `*.test.ts` 擋在編譯之外，
 * 測試不會被部署上去。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"]
  }
});
