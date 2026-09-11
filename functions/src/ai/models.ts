/**
 * 能拿來讀收據的模型。
 *
 * **為什麼寫死在程式裡**（照 Codex 的做法）：OpenAI 的模型清單 API 只回名稱，
 * 不說哪個模型能看圖、支援結構化輸出。讓後台自由輸入的話，選到一個不能看圖
 * 的模型，全站辨識就壞了，而且壞的方式是每一張都扣點、每一張都失敗。
 *
 * 新模型出來要改這裡、重新部署；在這張表裡切換則不用。
 */
export interface AiModel {
  id: string;
  label: string;
  note: string;
}

export const AI_MODELS: readonly AiModel[] = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "預設。最便宜，文字辨識跟 Terra 只差一點" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Luna 讀不準時的備案，貴 10 倍" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "最準，再貴 2.5 倍" }
];

export const DEFAULT_MODEL = "gpt-5.6-luna";

export function isAllowedModel(value: unknown): value is string {
  return typeof value === "string" && AI_MODELS.some(model => model.id === value);
}

export function resolveModel(value: unknown): string {
  return isAllowedModel(value) ? value : DEFAULT_MODEL;
}

/** 後台顯示用。短到四碼的金鑰不顯示 —— 那等於整把。 */
export function keyTail(apiKey: string): string {
  return apiKey.length > 4 ? apiKey.slice(-4) : "";
}
