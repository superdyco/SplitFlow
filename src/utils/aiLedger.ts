/** 後台點數紀錄的顯示文字。AI 設定頁與使用者詳情共用。 */

const TYPE_LABELS: Record<string, string> = {
  use: "辨識",
  adjust: "調整",
  free: "免費",
  purchase: "儲值",
  revoke: "退款扣回"
};

const RESULT_LABELS: Record<string, string> = {
  read: "讀出",
  unreadable: "讀不出金額",
  not_receipt: "不是收據",
  ai_error: "AI 出錯",
  timeout: "逾時"
};

/** 函式最長跑 60 秒；pending 超過一分鐘就不會回來了。 */
const PENDING_GRACE_MS = 60_000;

export function ledgerTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * 一直停在 pending 代表函式在呼叫 AI 之後當掉了：扣了點卻沒有結果。
 * 申訴時要一眼看得出來，所以跟一般的失敗分開講。
 */
export function ledgerResultLabel(
  row: { type: string; readResult: string | null; at: string | null },
  now: Date
): string {
  if (row.type !== "use") return "";
  if (row.readResult === "pending") {
    const at = row.at ? Date.parse(row.at) : 0;
    return now.getTime() - at > PENDING_GRACE_MS ? "沒有回來" : "辨識中";
  }
  return row.readResult ? (RESULT_LABELS[row.readResult] ?? row.readResult) : "";
}
