/**
 * 呼叫 OpenAI。只有這支 import `openai`。
 *
 * **不重試**（maxRetries: 0）：每一次呼叫都花錢，而使用者正盯著「辨識中…」。
 * 失敗了就照規則扣點、回報，要不要再按一次由他決定。
 */
import OpenAI from "openai";
import { RECEIPT_INSTRUCTIONS, RECEIPT_SCHEMA } from "./receipt.js";

const TIMEOUT_MS = 30_000;

export interface ModelOutput {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
}

const FORMAT = {
  format: { type: "json_schema" as const, name: "receipt", schema: RECEIPT_SCHEMA, strict: true }
};

async function run(apiKey: string, model: string, content: unknown[]): Promise<ModelOutput> {
  // 明寫「非串流」的參數型別。寫成 Parameters<create>[0] 的話會落在串流與非串流的
  // 聯集上，回傳型別跟著變成聯集，就讀不到 output_text 與 usage。
  const response = await client(apiKey).responses.create({
    model,
    input: [{ role: "user", content }],
    text: FORMAT
  } as OpenAI.Responses.ResponseCreateParamsNonStreaming);
  return {
    text: response.output_text ?? "",
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens
  };
}

export function readReceiptImage(input: {
  apiKey: string;
  model: string;
  base64: string;
  mime: string;
}): Promise<ModelOutput> {
  return run(input.apiKey, input.model, [
    { type: "input_text", text: RECEIPT_INSTRUCTIONS },
    // high：收據上的字很小，縮成低解析度就讀不出金額了。長邊 1600px 約兩千多個 token。
    { type: "input_image", image_url: `data:${input.mime};base64,${input.base64}`, detail: "high" }
  ]);
}

/** 後台「測試目前的設定」用：同一個模型、同一份格式，只是把照片換成文字。 */
export function readReceiptText(input: { apiKey: string; model: string; text: string }): Promise<ModelOutput> {
  return run(input.apiKey, input.model, [
    { type: "input_text", text: `${RECEIPT_INSTRUCTIONS}\n\n以下是收據上的文字：\n${input.text}` }
  ]);
}

export const SAMPLE_RECEIPT_TEXT = [
  "セブン-イレブン 新宿西口店",
  "2026年9月10日(木) 19:05",
  "おにぎり 鮭       ¥160",
  "緑茶 500ml        ¥140",
  "小計              ¥300",
  "消費税(8%)         ¥24",
  "合計              ¥324"
].join("\n");

export function classifyAiError(err: unknown): "timeout" | "ai_error" {
  return err instanceof OpenAI.APIConnectionTimeoutError ? "timeout" : "ai_error";
}

/**
 * 存設定之前驗一次：金鑰對不對、這把金鑰用不用得了這個模型。
 *
 * 查詢單一模型不產生 token 費用。驗不到的是「帳戶沒錢」—— 那要真的呼叫一次，
 * 見後台的「測試目前的設定」。
 */
export async function verifyModel(apiKey: string, model: string): Promise<string | null> {
  try {
    await client(apiKey).models.retrieve(model);
    return null;
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) return "金鑰無效或已被撤銷";
    if (err instanceof OpenAI.NotFoundError || err instanceof OpenAI.PermissionDeniedError) {
      return `這把金鑰用不了 ${model}`;
    }
    if (err instanceof OpenAI.APIConnectionTimeoutError) return "OpenAI 太久沒有回應，請稍後再試";
    return `驗證失敗：${err instanceof Error ? err.message : String(err)}`;
  }
}
