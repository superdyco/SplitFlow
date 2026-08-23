import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALL_TIMEOUT_MS, guardStall } from "../src/utils/stallGuard";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("guardStall", () => {
  it("正常回來的讀取不會驚動任何人", async () => {
    const onStall = vi.fn();
    const value = await guardStall(Promise.resolve("清單"), onStall);

    expect(value).toBe("清單");
    // 時間往前推超過門檻，確認計時器真的被清掉了 —— 沒清的話補救會晚一步才炸。
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("超過門檻沒回來就叫人來救", async () => {
    const onStall = vi.fn();
    let release!: (value: string) => void;
    const read = new Promise<string>(resolve => {
      release = resolve;
    });

    const guarded = guardStall(read, onStall);
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 1);
    expect(onStall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onStall).toHaveBeenCalledTimes(1);

    // 重點：補救之後，原本那個讀取的結果照樣交出去，不是換一份別的。
    release("清單");
    await expect(guarded).resolves.toBe("清單");
  });

  it("只叫一次 —— 一直不回來也不會變成連環呼叫", async () => {
    const onStall = vi.fn();
    void guardStall(new Promise(() => {}), onStall);

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 10);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("讀取失敗時錯誤原樣往外丟，不會被吞掉", async () => {
    const onStall = vi.fn();
    const failed = guardStall(Promise.reject(new Error("permission-denied")), onStall);

    await expect(failed).rejects.toThrow("permission-denied");
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("卡住之後才失敗的，補救叫過了，錯誤也還是要傳出去", async () => {
    const onStall = vi.fn();
    let fail!: (err: Error) => void;
    const read = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const guarded = guardStall(read, onStall);

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS);
    expect(onStall).toHaveBeenCalledTimes(1);

    fail(new Error("unavailable"));
    await expect(guarded).rejects.toThrow("unavailable");
  });

  it("門檻可以改，預設是 1.5 秒", async () => {
    expect(STALL_TIMEOUT_MS).toBe(1500);

    const onStall = vi.fn();
    void guardStall(new Promise(() => {}), onStall, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
});
