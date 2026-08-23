/**
 * App 被丟到背景多久。
 *
 * 為什麼需要它：任務列表有時候會卡 30 秒，而最可疑的變數是「剛從背景回來」——
 * 但那個變數我們一直沒有量。三批、17 筆資料裡，連一次「這次進頁面之前 App
 * 在背景待了多久」都沒有記錄到，所以「是不是背景造成的」到現在還是答不出來。
 *
 * 用 performance.now() 而不是 Date.now()：手機睡醒之後會校時，而「睡了多久」
 * 正是這裡要量的東西 —— 用會被校正的時鐘去量它，量到的會是校正量本身。
 *
 * 純函式模組（時鐘由呼叫端傳進來），不 import firebase 也不 import vue。
 * 綁事件的那一小段在最後面，是唯一會碰 document 的地方。
 */

/** 進背景的時刻。null 代表現在在前景。 */
let hiddenAt: number | null = null;
/** 最近一次在背景待了多久。 */
let lastHiddenMs = 0;
/** 最近一次回到前景的時刻。null 代表從載入到現在沒進過背景。 */
let visibleAt: number | null = null;

export interface BackgroundContext {
  /** 最近一次待在背景多久。0 代表這個分頁從載入到現在沒進過背景。 */
  hiddenMs: number;
  /** 從背景回來之後過了多久才走到這裡。0 代表沒進過背景。 */
  sinceVisibleMs: number;
}

/**
 * 連續兩次 hidden 只認第一次。
 *
 * iOS 會同時發 visibilitychange 與 pagehide，兩個都綁的話同一次進背景會進來
 * 兩次。認第二次的話起點被往後推，量出來的背景時間就短了 —— 而長的那個才是
 * 我們在找的東西。
 */
export function noteHidden(at: number): void {
  if (hiddenAt !== null) return;
  hiddenAt = at;
}

export function noteVisible(at: number): void {
  // 沒進過背景就回到前景，代表這是重複事件，不是真的切換。
  if (hiddenAt === null) return;
  lastHiddenMs = Math.round(at - hiddenAt);
  hiddenAt = null;
  visibleAt = at;
}

export function backgroundContext(at: number): BackgroundContext {
  return {
    hiddenMs: lastHiddenMs,
    sinceVisibleMs: visibleAt === null ? 0 : Math.round(at - visibleAt)
  };
}

/** 測試用。正式流程裡這些狀態跟著分頁一起生一起死。 */
export function resetVisibility(): void {
  hiddenAt = null;
  lastHiddenMs = 0;
  visibleAt = null;
}

/**
 * 綁事件。main.ts 呼叫一次。
 *
 * 兩組事件都綁，因為 iOS 上單靠 visibilitychange 不可靠 —— 鎖螢幕、切換 App
 * 這些情境有時候只發得出 pagehide/pageshow。寧可重複收到（上面的兩個函式
 * 都擋得住重複），也不要漏掉那次真正想量的背景。
 */
export function watchVisibility(): void {
  document.addEventListener("visibilitychange", () => {
    const at = performance.now();
    if (document.visibilityState === "hidden") noteHidden(at);
    else noteVisible(at);
  });
  window.addEventListener("pagehide", () => noteHidden(performance.now()));
  window.addEventListener("pageshow", () => noteVisible(performance.now()));
}
