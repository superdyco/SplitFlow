/**
 * 虛擬成員的 member 文件 ID。
 *
 * 格式是 `v_` + 20 個小寫英數，固定 22 字元。這個 id 會被寫進
 * `task.memberIds`，而 `memberIds` 同時是權限清單（`isTaskMember()` 判斷的是
 * `request.auth.uid in memberIds`），所以它**必須不可能等於任何真實 uid**：
 * Firebase Auth 的 uid 是 28 字元，長度就對不上。
 *
 * 這條格式在四個地方各出現一次 —— 這裡、Flutter 的
 * `lib/domain/virtual_member.dart`、`firestore.rules`、規則測試。改一處就要改四處。
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const BODY_LENGTH = 20;

export const VIRTUAL_MEMBER_ID_PATTERN = /^v_[a-z0-9]{20}$/;

/**
 * 用 `crypto.getRandomValues` 而不是 `Math.random`，理由是碰撞而不是保密 ——
 * 這個 id 不是門禁（邀請碼才是），知道它也進不來，但它一旦跟另一個虛擬成員
 * 撞號，兩個人的帳就會合在一起。
 *
 * `% ALPHABET.length` 有模數偏差，這裡無所謂：20 個字元的 36 進位有約 103 bits，
 * 偏差吃掉的那點熵離碰撞還差得很遠。
 */
export function generateVirtualMemberId(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);

  let id = "v_";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}

export function isVirtualMemberId(id: string): boolean {
  return VIRTUAL_MEMBER_ID_PATTERN.test(id);
}
