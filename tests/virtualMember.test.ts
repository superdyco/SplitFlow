import { describe, expect, it } from "vitest";
import {
  VIRTUAL_MEMBER_ID_PATTERN,
  generateVirtualMemberId,
  isVirtualMemberId
} from "@/utils/virtualMember";

describe("generateVirtualMemberId", () => {
  it("符合規則裡那條正規式", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateVirtualMemberId()).toMatch(VIRTUAL_MEMBER_ID_PATTERN);
    }
  });

  // Firebase uid 是 28 字元。長度對不上，就不可能有虛擬成員的 id
  // 撞到真人的 uid —— 而 memberIds 同時是權限清單，撞到就是權限漏洞。
  it("固定 22 字元，跟 Firebase uid 的 28 字元對不上", () => {
    expect(generateVirtualMemberId()).toHaveLength(22);
  });

  it("連續產生不重複", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateVirtualMemberId()));
    expect(ids.size).toBe(500);
  });
});

describe("isVirtualMemberId", () => {
  it("認得合格的 id", () => {
    expect(isVirtualMemberId("v_k3n8x2p9qz1m4w7t6r0a")).toBe(true);
  });

  it.each([
    ["沒有前綴", "k3n8x2p9qz1m4w7t6r0ab"],
    ["長度不對", "v_k3n8x2p9"],
    ["含大寫", "v_K3n8x2p9qz1m4w7t6r0a"],
    ["含底線", "v_k3n8x2p9qz1m4w7t6r_a"],
    ["真實 uid 長度", "abcdefghijklmnopqrstuvwxyz12"],
    ["空字串", ""]
  ])("擋掉%s", (_label, id) => {
    expect(isVirtualMemberId(id)).toBe(false);
  });
});
