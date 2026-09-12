/**
 * 「這個人能不能自己退出任務」的判斷。
 *
 * 抽成純函式的理由跟 `joinDecision`、`canDeleteReceipt` 一樣：這是安全邊界，
 * 值得被單獨測到。
 *
 * **為什麼退出非得在伺服器端做**：退出要把自己從 `task.memberIds` 拿掉，而那
 * 個陣列同時是權限清單。規則裡曾經有一條讓成員自己改它的路
 * （`updatesSelfMembershipOnly`），那是一個洞 —— 只要能改那個陣列，就能把
 * 別人移出去、或把自己塞進別的任務。所以那條規則被刪掉了，這件事改走 callable。
 */

export interface LeaveTaskDoc {
  status?: unknown;
  ownerId?: unknown;
  memberIds?: unknown;
}

export interface LeaveMemberDoc {
  active?: unknown;
  virtual?: unknown;
}

export type LeaveVerdict =
  /** 可以退出。 */
  | { kind: "allow" }
  /** 不是這個任務的成員，或任務不存在。連任務存不存在都不該讓他知道。 */
  | { kind: "not-member" }
  /** 擁有者不能退出 —— 退了就沒有人管得了這個任務。 */
  | { kind: "owner" }
  /** 已經退出過了。當成成功，重按一次不該變成錯誤。 */
  | { kind: "already-left" }
  /** 封存的任務唯讀，成員也不該變動。 */
  | { kind: "inactive-task" };

export function canLeaveTask(input: {
  task: LeaveTaskDoc | null;
  member: LeaveMemberDoc | null;
  uid: string;
}): LeaveVerdict {
  const { task, member, uid } = input;

  if (!task) return { kind: "not-member" };

  /*
    虛擬成員沒有帳號，不可能是呼叫者 —— 但這一行不是裝飾：合成 id 會進
    memberIds，萬一哪天有路徑讓人帶著虛擬成員的身分呼叫，這裡就是最後一關。
  */
  if (member?.virtual === true) return { kind: "not-member" };

  const memberIds = Array.isArray(task.memberIds) ? task.memberIds : [];

  if (!memberIds.includes(uid)) {
    // 有成員文件但不在名單上 = 他已經離開了（自己退出，或被移除）。
    return member ? { kind: "already-left" } : { kind: "not-member" };
  }

  // 擁有者的判斷排在封存前面：對他來說「你是擁有者」才是有用的那句話。
  if (task.ownerId === uid) return { kind: "owner" };

  if (task.status !== "active") return { kind: "inactive-task" };

  return { kind: "allow" };
}
