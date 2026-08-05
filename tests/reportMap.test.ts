import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMapPath, reportMapUrl } from "@/services/reportMap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportMapPath", () => {
  // 這個路徑必須跟 storage.rules 裡公開讀取的那條 match 對得起來，
  // 對不上的話圖傳得上去但公開頁面讀不到。
  it("對得上 storage.rules 的公開路徑", () => {
    expect(reportMapPath("t1", "r1")).toBe("tasks/t1/reports/r1/map.png");
  });
});

describe("reportMapUrl", () => {
  it("斜線要編碼成 %2F —— Storage REST 把整個物件名稱當成單一路徑參數", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "demo.appspot.com");

    expect(reportMapUrl("t1", "r1")).toBe(
      "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/" +
        "tasks%2Ft1%2Freports%2Fr1%2Fmap.png?alt=media"
    );
  });

  it("一定要帶 alt=media —— 少了它拿到的是物件的 JSON metadata 而不是圖片", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "demo.appspot.com");

    expect(reportMapUrl("t1", "r1")).toContain("?alt=media");
  });
});
