import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALL_TIMEOUT_MS, guardStall, readWithRecovery } from "../src/utils/stallGuard";

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

describe("readWithRecovery", () => {
  it("一次就成功的讀取只發一趟", async () => {
    const read = vi.fn().mockResolvedValue("任務");
    const onStall = vi.fn();

    await expect(readWithRecovery(read, onStall)).resolves.toBe("任務");
    expect(read).toHaveBeenCalledTimes(1);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("卡住補救之後那趟死掉的話，自己再讀一次", async () => {
    // 實際看到的樣子：切斷重連把還在半路的讀取一起弄死，Firestore 吐 unavailable。
    const read = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error("unavailable")), 2000)))
      .mockResolvedValueOnce("任務");
    const onStall = vi.fn();

    const guarded = readWithRecovery(read, onStall);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(guarded).resolves.toBe("任務");
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("守衛沒觸發過就不重試 —— 權限不足再讀一次也是一樣的答案", async () => {
    const read = vi.fn().mockRejectedValue(new Error("permission-denied"));
    const onStall = vi.fn();

    await expect(readWithRecovery(read, onStall)).rejects.toThrow("permission-denied");
    expect(read).toHaveBeenCalledTimes(1);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("重試也失敗就把錯誤交出去，不會無限重來", async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error("第一趟")), 2000)))
      .mockImplementationOnce(() => Promise.reject(new Error("第二趟")));
    const onStall = vi.fn();

    // 期待要在推時間之前掛上去。不然 guarded 會在沒有任何 handler 的那一刻
    // 拒絕，Node 先記成 unhandled rejection，測試才慢一步接手。
    const guarded = readWithRecovery(read, onStall);
    const rejects = expect(guarded).rejects.toThrow("第二趟");
    await vi.advanceTimersByTimeAsync(2000);

    await rejects;
    expect(read).toHaveBeenCalledTimes(2);
  });
});
