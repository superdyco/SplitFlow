/**
 * 最近發生的錯誤，留在這台裝置上。
 *
 * 手機上打不開 console，而使用者的回報永遠是「它壞了」。這裡把錯誤攔下來留成
 * 一份清單，個人設定頁的診斷資訊會連它一起複製出去。
 *
 * **只放在記憶體裡，重整就沒了。** 寫進 localStorage 要處理配額、清除與跨分頁
 * 競爭，而真正要查的錯誤幾乎都是「剛剛那一下」—— 重整之後本來就重現不了，
 * 留著舊的只會讓人去追一個已經不存在的問題。
 *
 * 純函式模組，不 import firebase 也不 import vue，所以測得動。
 */

/** 50 筆是「查得到剛才發生什麼」與「不要無限吃記憶體」之間的折衷。 */
const MAX_ENTRIES = 50;

export interface LoggedError {
  /** epoch ms。格式化留給呈現端，這裡不碰 locale。 */
  at: number;
  /** 從哪裡進來的：firebase、window、promise、vue ... */
  source: string;
  message: string;
  /** 連續重複的同一個錯誤只佔一筆，用次數表示。 */
  count: number;
}

const entries: LoggedError[] = [];

/**
 * 把任何丟出來的東西變成一行字。
 *
 * `code` 一定要留 —— Firebase 的錯誤訊息會隨版本改寫，`permission-denied`
 * 這種 code 才是能拿去查、能拿來比對規則的東西。
 */
export function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as { code?: unknown; message?: unknown };
    const code = typeof maybe.code === "string" ? maybe.code : "";
    const message = typeof maybe.message === "string" ? maybe.message : "";
    if (code && message) return `${code} ${message}`;
    if (code || message) return code || message;
  }
  return String(error);
}

export function logError(source: string, error: unknown): void {
  const message = describeError(error);
  const last = entries[entries.length - 1];

  /*
    重試迴圈（背景上傳、斷線重連）會用同一個錯誤在幾秒內灌滿 50 格，
    把最舊、通常也最接近起因的那幾筆擠掉。同樣的連續錯誤併成一筆。
  */
  if (last && last.source === source && last.message === message) {
    last.count += 1;
    last.at = Date.now();
    return;
  }

  entries.push({ at: Date.now(), source, message, count: 1 });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** 回傳複本：呼叫端拿去渲染，不該能改到這裡面的東西。 */
export function recentErrors(): LoggedError[] {
  return entries.map(entry => ({ ...entry }));
}

export function clearErrors(): void {
  entries.length = 0;
}
