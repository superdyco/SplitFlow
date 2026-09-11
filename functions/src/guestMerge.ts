/**
 * 訪客合併進正式帳號時，每一份文件要怎麼改。
 *
 * 全部是純函式 —— 讀資料、寫回去是 `index.ts` 裡 `mergeGuest` 的事。
 *
 * **核心原則：改寫的目標 id 永遠沒人用過。** 合併麻煩的根源是「兩個身分疊成
 * 一個人」：分攤要加總、自己付給自己的付款要刪、角色要比大小。只要目標是空的，
 * 每個任務都只是「把 X 改名成 Y」：
 *
 *   - 正式帳號不在這個任務裡 → 目標是正式帳號
 *   - 兩個身分都在 → 目標是一個算出來的虛擬成員
 *
 * 唯一的例外是 `createdBy`：一律給正式帳號。它決定 `canManageExpense`，給虛擬
 * 成員的話本人就改不了自己當訪客時記的帳。
 */
import { createHash } from "node:crypto";

export const GUEST_PROVIDER = "anonymous";

export type Role = "owner" | "admin" | "member";
export type Data = Record<string, unknown>;

export interface MergeIds {
  /** 訪客的 uid。 */
  guest: string;
  /** 正式帳號的 uid。 */
  account: string;
  /** 這個任務裡訪客要改成的 id：正式帳號本人，或算出來的虛擬成員。 */
  target: string;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const NICKNAME_MAX = 20;
const GUEST_SUFFIX = "（訪客）";

/**
 * 共同任務裡訪客變成的虛擬成員 id。
 *
 * **算出來而不是隨機產生**：合併改到一半失敗再跑一次時，要落在同一個 id 上。
 * 隨機的話第二次會生出另一個虛擬成員，同一個人的帳就分裂成兩份。
 *
 * 格式跟 `src/utils/virtualMember.ts` 一致（`v_` + 20 碼小寫英數）——
 * `firestore.rules` 靠長度把它跟真實 uid 分開。
 */
export function virtualIdFor(guest: string, taskId: string): string {
  const bytes = createHash("sha256").update(`${guest}:${taskId}`).digest();
  let id = "v_";
  for (let i = 0; i < 20; i += 1) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

/**
 * 看的是**成員文件在不在**，不是 memberIds：正式帳號可能曾被移出這個任務，
 * 成員文件與舊帳目都還在，直接改成他會撞上。
 */
export function mergeTarget(input: {
  guest: string;
  account: string;
  taskId: string;
  accountHasMember: boolean;
}): string {
  return input.accountHasMember ? virtualIdFor(input.guest, input.taskId) : input.account;
}

function swapId(value: unknown, from: string, to: string): unknown {
  return value === from ? to : value;
}

function swapInList(list: unknown, from: string, to: string): unknown {
  if (!Array.isArray(list) || !list.includes(from)) return list;
  return [...new Set(list.map(item => (item === from ? to : item)))];
}

/** 目標照理不會已經在 map 裡；萬一在，加總而不是蓋掉 —— 蓋掉就是少算一筆錢。 */
function renameKey(map: unknown, from: string, to: string): unknown {
  if (!map || typeof map !== "object" || !(from in map)) return map;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    const name = key === from ? to : key;
    const existing = result[name];
    result[name] =
      typeof existing === "number" && typeof value === "number" ? existing + value : value;
  }
  return result;
}

/** 只留下真的變了的欄位。沒有就回 null，呼叫端就不必寫。 */
function changedFields(before: Data, after: Data): Data | null {
  const changes: Data = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value) !== JSON.stringify(before[key])) changes[key] = value;
  }
  return Object.keys(changes).length ? changes : null;
}

function pick(data: Data, keys: string[]): Data {
  const result: Data = {};
  for (const key of keys) if (key in data) result[key] = data[key];
  return result;
}

export function rewriteExpense(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["paidBy", "createdBy", "splits", "splitMemberIds"]);
  const after: Data = { ...before };
  if ("paidBy" in before) after.paidBy = swapId(before.paidBy, ids.guest, ids.target);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  if ("splits" in before) after.splits = renameKey(before.splits, ids.guest, ids.target);
  if ("splitMemberIds" in before) {
    after.splitMemberIds = swapInList(before.splitMemberIds, ids.guest, ids.target);
  }
  return changedFields(before, after);
}

export function rewritePayment(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["from", "to", "createdBy"]);
  const after: Data = { ...before };
  if ("from" in before) after.from = swapId(before.from, ids.guest, ids.target);
  if ("to" in before) after.to = swapId(before.to, ids.guest, ids.target);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  return changedFields(before, after);
}

export function rewriteSettlement(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["balances", "transfers", "memberNames", "createdBy"]);
  const after: Data = { ...before };
  if (Array.isArray(before.balances)) {
    after.balances = before.balances.map(row =>
      row && typeof row === "object"
        ? { ...row, uid: swapId((row as Data).uid, ids.guest, ids.target) }
        : row
    );
  }
  if (Array.isArray(before.transfers)) {
    after.transfers = before.transfers.map(row =>
      row && typeof row === "object"
        ? {
            ...row,
            from: swapId((row as Data).from, ids.guest, ids.target),
            to: swapId((row as Data).to, ids.guest, ids.target)
          }
        : row
    );
  }
  if ("memberNames" in before) {
    after.memberNames = renameKey(before.memberNames, ids.guest, ids.target);
  }
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  return changedFields(before, after);
}

/**
 * 任務文件。`memberCount` 不動 —— 這只是改名。
 *
 * 共同任務（目標是虛擬成員）裡，訪客**從 adminIds 拿掉**而不是換成虛擬成員：
 * 合成 id 在 adminIds 裡不會讓任何人拿到權限，只會讓畫面顯示一個永遠不生效的
 * 管理員。訪客原本是 owner 或 admin 的話，那個身分交給正式帳號。
 * owner 一定在 adminIds 裡（`createsOwnTask`），所以這條也涵蓋了 owner。
 */
export function rewriteTask(task: Data, ids: MergeIds): Data {
  const shared = ids.target !== ids.account;
  const before = pick(task, ["ownerId", "adminIds", "memberIds", "createdBy"]);
  const after: Data = { ...before };

  if ("ownerId" in before) after.ownerId = swapId(before.ownerId, ids.guest, ids.account);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  if ("memberIds" in before) after.memberIds = swapInList(before.memberIds, ids.guest, ids.target);

  const admins = before.adminIds;
  if (Array.isArray(admins) && admins.includes(ids.guest)) {
    after.adminIds = shared
      ? [...new Set([...admins.filter(id => id !== ids.guest), ids.account])]
      : swapInList(admins, ids.guest, ids.account);
  }

  return changedFields(before, after) ?? {};
}

/** 共同任務裡，正式帳號的角色要不要升。回 null 代表不必寫。 */
export function accountRoleAfterMerge(guestRole: unknown, accountRole: unknown): Role | null {
  if (guestRole === "owner" && accountRole !== "owner") return "owner";
  if (guestRole === "admin" && accountRole === "member") return "admin";
  return null;
}

function guestLabel(nickname: string): string {
  const name = Array.from(nickname.trim())
    .slice(0, NICKNAME_MAX - GUEST_SUFFIX.length)
    .join("");
  return name ? `${name}${GUEST_SUFFIX}` : "訪客";
}

/**
 * 訪客的成員文件搬到目標名下。**joinedAt 一定保留** —— 結算的餘數是照加入
 * 順序分的，換掉它那一塊錢就落到別人頭上。
 */
export function movedMember(
  guestMember: Data,
  input: { ids: MergeIds; guestNickname: string; accountNickname: string }
): Data {
  const { ids } = input;
  if (ids.target === ids.account) {
    return {
      ...guestMember,
      uid: ids.account,
      nickname: input.accountNickname || guestMember.nickname
    };
  }
  return {
    ...guestMember,
    uid: ids.target,
    nickname: guestLabel(input.guestNickname || String(guestMember.nickname ?? "")),
    role: "member",
    virtual: true
  };
}

/**
 * 誰可以把誰合併進來。回 null 代表放行，否則回給使用者看的原因。
 *
 * 只接受匿名來源：正式帳號之間永遠不能互相合併。呼叫者自己也不能是匿名 ——
 * 否則一個訪客就能把另一個訪客吞掉。
 */
export function checkMergeCaller(input: {
  callerUid: string;
  callerProvider: string | undefined;
  guestUid: string;
  guestProvider: string | undefined;
}): string | null {
  if (input.callerProvider === GUEST_PROVIDER) return "要合併進去的必須是正式帳號";
  if (input.guestProvider !== GUEST_PROVIDER) return "只有訪客身分可以合併";
  if (input.guestUid === input.callerUid) return "不能合併到自己";
  return null;
}
