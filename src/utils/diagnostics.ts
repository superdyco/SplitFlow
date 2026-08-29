/**
 * 診斷資訊的純文字版本。
 *
 * 目的很具體：**使用者按一下複製、貼進聊天室，就足以判斷問題在哪。**
 * 所以每一欄都要對應到一種真的發生過的故障 —— 卡在待上傳、跑的是舊版、
 * 金鑰沒設所以地點搜尋悄悄退回純文字輸入。看起來厲害但答不出問題的欄位不要放。
 *
 * 跟 `settlementText.ts` 一樣是純函式：不 import firebase 也不 import vue，
 * 呼叫端負責把值蒐集好傳進來，這裡只排版。
 */
import type { LoggedError } from "@/utils/debugLog";

export interface DiagnosticsInput {
  /** build 時內嵌的 `__APP_VERSION__`。 */
  version: string;
  uid: string;
  /** 已經翻成中文的供應商名稱，空字串代表查不到。 */
  loginMethod: string;
  online: boolean;
  /** 從主畫面圖示啟動（PWA）還是瀏覽器分頁。 */
  installed: boolean;
  /**
   * 待上傳收據每一筆的失敗次數。
   * `null` 代表佇列讀不到（無痕模式、儲存權限被拒），那本身就是一條線索。
   */
  queuedReceipts: number[] | null;
  placesKey: boolean;
  mapsKey: boolean;
  userAgent: string;
  errors: LoggedError[];
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString("zh-TW", { hour12: false });
}

function receiptLine(queued: number[] | null): string {
  if (queued === null) return "待上傳收據 讀不到（可能是無痕模式或儲存權限被拒）";
  if (!queued.length) return "待上傳收據 沒有";
  // 失敗次數是關鍵：0 次是「還沒輪到」，多次是「一直傳不上去」，兩者的處置不同。
  const failing = queued.filter(attempts => attempts > 0);
  const detail = failing.length ? `，其中 ${failing.length} 筆試過 ${failing.join("、")} 次` : "";
  return `待上傳收據 ${queued.length} 筆${detail}`;
}

export function buildDiagnosticsText(input: DiagnosticsInput): string {
  const lines = [
    "簡單分帳診斷資訊",
    `版本 ${input.version}`,
    `使用者 ${input.uid || "未登入"}`,
    `登入方式 ${input.loginMethod || "查不到"}`,
    `連線 ${input.online ? "線上" : "離線"}`,
    `啟動方式 ${input.installed ? "已安裝的 App" : "瀏覽器"}`,
    receiptLine(input.queuedReceipts),
    `地點搜尋金鑰 ${input.placesKey ? "已設定" : "未設定"}`,
    `地圖金鑰 ${input.mapsKey ? "已設定" : "未設定"}`,
    `瀏覽器 ${input.userAgent}`,
    ""
  ];

  if (!input.errors.length) {
    lines.push("這次開啟之後沒有記錄到錯誤。");
    return lines.join("\n");
  }

  lines.push(`最近的錯誤（${input.errors.length} 筆，新的在下面）`);
  for (const entry of input.errors) {
    const repeat = entry.count > 1 ? ` ×${entry.count}` : "";
    lines.push(`${clockTime(entry.at)} [${entry.source}] ${entry.message}${repeat}`);
  }

  return lines.join("\n");
}
