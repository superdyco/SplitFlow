import type { FirestoreError } from "firebase/firestore";

export function firebaseErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const maybe = error as FirestoreError;
    return maybe.message || String(error);
  }
  return String(error);
}

export function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}為必填`);
  return trimmed;
}

/**
 * 表單即時提示用。回傳 null 代表沒問題。
 * 跟 `required` 不同的是不會丟例外，而且還沒開始輸入時不嘮叨。
 */
export function textFieldError(
  value: string,
  label: string,
  { max, touched = true }: { max?: number; touched?: boolean } = {}
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return touched ? `${label}為必填` : null;
  if (max && trimmed.length > max) return `${label}最多 ${max} 個字`;
  return null;
}

/** 結束日期不能早於開始日期。兩邊都有填才檢查。 */
export function dateRangeError(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return null;
  return endDate < startDate ? "結束日期不能早於開始日期" : null;
}

export function buildInviteUrl(inviteCode: string): string {
  return `${window.location.origin}/join/${inviteCode}`;
}

/** 結算紀錄同一天可能有好幾筆，所以要帶時間才分得出來。 */
export function formatDateTime(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "";
  const date = (value as { toDate: () => Date }).toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "";
  const date = (value as { toDate: () => Date }).toDate();
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
