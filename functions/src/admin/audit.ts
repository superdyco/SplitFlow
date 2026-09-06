/**
 * 稽核日誌的一筆紀錄。
 *
 * 這個後台看得到全部使用者的資料，所以「有沒有動手」不是唯一該追的事，
 * 「看了誰」同樣是 —— 所以 `view.*` 也在這裡，不是只有處置。
 *
 * 組 payload 抽成純函式，是因為它承擔兩個規則，而兩個都是「錯了不會噴錯」
 * 的那種：處置必須有理由，以及檢視不該夾帶理由。少了測試，這兩條會在某次
 * 重構之後靜靜失效，而發現的方式是三個月後翻日誌時發現一整段是空的。
 */

export const VIEW_ACTIONS = ["view.user", "view.task", "view.report", "export.stats"] as const;

/** 會改到別人東西的三個。這三個才需要理由。 */
export const ACT_ACTIONS = ["act.revokeReport", "act.disableUser", "act.archiveTask"] as const;

/** 不是管理者做的，但正是最該留下來的那種。 */
export const DENIED_ACTION = "denied.access" as const;

export type AdminAction =
  | (typeof VIEW_ACTIONS)[number]
  | (typeof ACT_ACTIONS)[number]
  | typeof DENIED_ACTION;

export type TargetType = "user" | "task" | "report" | "route";

/** 日誌保存 400 天，交給 Firestore 的 TTL 政策刪。 */
export const RETENTION_DAYS = 400;

/** 暱稱與任務名是使用者輸入，不設上限就等於讓別人決定日誌文件多大。 */
const MAX_LABEL = 120;
const MAX_REASON = 500;

export interface AuditInput {
  action: AdminAction;
  adminUid: string;
  adminEmail: string;
  targetType: TargetType;
  targetId: string;
  /** 當下的暱稱／任務名。 */
  targetLabel: string;
  reason?: unknown;
  ip: string;
  userAgent: string;
  result?: "ok" | "error";
  at: Date;
}

export interface AuditEntry {
  at: Date;
  adminUid: string;
  adminEmail: string;
  action: AdminAction;
  targetType: TargetType;
  targetId: string;
  targetLabel: string;
  reason: string | null;
  ip: string;
  userAgent: string;
  result: "ok" | "error";
  expireAt: Date;
}

export type AuditResult =
  | { ok: true; entry: AuditEntry }
  | { ok: false; problem: "reason-required" | "reason-too-long" };

function needsReason(action: AdminAction): boolean {
  return (ACT_ACTIONS as readonly string[]).includes(action);
}

export function auditEntry(input: AuditInput): AuditResult {
  const raw = typeof input.reason === "string" ? input.reason.trim() : "";

  if (needsReason(input.action)) {
    /*
      空白字元不算理由。不 trim 的話，一個空格就能通過必填檢查 ——
      而那正是趕時間的人會做的事。
    */
    if (!raw) return { ok: false, problem: "reason-required" };
    if (raw.length > MAX_REASON) return { ok: false, problem: "reason-too-long" };
  }

  /*
    檢視一律不帶理由，即使呼叫端送了。

    為什麼要主動丟掉而不是原樣存下來：`reason` 這個欄位在日誌裡的意思是
    「這次處置的正當理由」。讓檢視也能塞字串進去，日誌讀起來就會像是有人
    替一次純瀏覽寫了辯解 —— 而且那段字是前端給的，不是誰審過的。
  */
  const reason = needsReason(input.action) ? raw : null;

  return {
    ok: true,
    entry: {
      at: input.at,
      adminUid: input.adminUid,
      adminEmail: input.adminEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      // 存當下的名字而不是指標。理由跟結算快照存 memberNames 一樣：
      // 之後改名了，日誌要說得出「當時看的是誰」。
      targetLabel: input.targetLabel.slice(0, MAX_LABEL),
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      result: input.result ?? "ok",
      expireAt: new Date(input.at.getTime() + RETENTION_DAYS * 86_400_000)
    }
  };
}

/**
 * 停用帳號真正生效的時間。
 *
 * `disabled` 擋的是換發新憑證，對方手上那張 ID token 最長還能用 1 小時 ——
 * 這段時間他仍然讀得到、也寫得進他已加入的任務。`revokeRefreshTokens` 救不了
 * 這一小時，它作廢的是 refresh token，不是已經發出去的 ID token。
 *
 * 這個限制被接受了，但**不能只活在文件裡**：`adminDisableUser` 回傳這個時間，
 * 讓確認對話框說得出確切幾點，而不是一句會被忽略的「可能有延遲」。
 */
export const TOKEN_GRACE_MS = 60 * 60 * 1000;

export function disableEffectiveAt(at: Date): Date {
  return new Date(at.getTime() + TOKEN_GRACE_MS);
}
