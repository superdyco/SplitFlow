import { describe, expect, it } from "vitest";
import { AI_MODELS, DEFAULT_MODEL, isAllowedModel, keyTail, resolveModel } from "./models.js";

describe("AI_MODELS", () => {
  it("預設模型在白名單裡，而且排第一", () => {
    expect(AI_MODELS[0].id).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("gpt-5.6-luna");
  });

  it("每一個都有顯示名稱與說明", () => {
    for (const model of AI_MODELS) {
      expect(model.label).not.toBe("");
      expect(model.note).not.toBe("");
    }
  });
});

describe("isAllowedModel", () => {
  it("白名單上的才算", () => {
    expect(isAllowedModel("gpt-5.6-terra")).toBe(true);
    expect(isAllowedModel("gpt-4o")).toBe(false);
    expect(isAllowedModel("")).toBe(false);
    expect(isAllowedModel(undefined)).toBe(false);
  });
});

describe("resolveModel", () => {
  it("白名單上的照用", () => {
    expect(resolveModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });

  it("不在白名單上（例如白名單改過）就退回預設 —— 不能讓一個舊名字把全站辨識弄壞", () => {
    expect(resolveModel("gpt-5.5")).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
  });
});

describe("keyTail", () => {
  it("只留末四碼", () => {
    expect(keyTail("sk-proj-abcdefgh1234")).toBe("1234");
  });

  it("太短的金鑰不回任何字元 —— 短到四碼就等於整把", () => {
    expect(keyTail("abcd")).toBe("");
    expect(keyTail("")).toBe("");
  });
});
