import { describe, expect, it, vi } from "vitest";
import { settleWrite } from "@/utils/offlineWrite";

describe("settleWrite", () => {
  it("伺服器有回應時回報 synced", async () => {
    await expect(settleWrite(Promise.resolve(), 1000)).resolves.toBe("synced");
  });

  it("逾時代表離線排隊中，不是失敗", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const result = settleWrite(never, 2500);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toBe("queued");
    vi.useRealTimers();
  });

  it("逾時之前就被拒絕的話要往外丟，那是真的錯誤", async () => {
    const denied = Promise.reject(new Error("permission-denied"));
    await expect(settleWrite(denied, 1000)).rejects.toThrow("permission-denied");
  });

  it("逾時之後才被拒絕不會變成 unhandled rejection", async () => {
    vi.useFakeTimers();
    let reject!: (err: Error) => void;
    const late = new Promise<void>((_, r) => {
      reject = r;
    });
    const result = settleWrite(late, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("queued");

    reject(new Error("太晚了"));
    // 微任務跑完都沒有 unhandled rejection 就算過。
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });
});
