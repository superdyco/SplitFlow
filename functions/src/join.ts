/**
 * 「這個人能不能用這個邀請碼加入這個任務」的判斷。
 *
 * 抽成純函式是因為這裡是**安全邊界**，而安全邊界值得被單獨測到。整支
 * callable 剩下的部分是讀三份文件、照著這裡的答案寫回去，沒有分支。
 *
 * 為什麼這段判斷不在 Security Rules 裡：規則能檢查的只有「這次寫入的內容」，
 * 而邀請碼是一個**不在寫入內容裡的秘密**。規則寫得出「他把自己加進了
 * memberIds」，寫不出「他知道邀請碼」—— 少了後者，前者就是「任何人只要
 * 知道 taskId 就能加入任何任務」。
 */

export interface InviteDoc {
  taskId?: unknown;
  active?: unknown;
}

export interface JoinTaskDoc {
  status?: unknown;
  inviteCode?: unknown;
  memberIds?: unknown;
}

export interface JoinMemberDoc {
  active?: unknown;
}

export type JoinDecision =
  /** 邀請碼查無此文件、已停用，或指向的任務不存在。對使用者是同一件事：連結無效。 */
  | { kind: "invalid" }
  /** 任務已封存或已刪除。跟連結無效要分開講 —— 使用者需要知道去找發起人。 */
  | { kind: "inactive-task" }
  /** 已經是有效成員了。重複點連結不該把人數加第二次。 */
  | { kind: "already" }
  /** 可以加入。`isNew` 決定要建立 member 文件還是把舊的復活。 */
  | { kind: "join"; isNew: boolean; countsUp: boolean };

export function joinDecision(input: {
  inviteCode: string;
  invite: InviteDoc | null;
  taskId: string;
  task: JoinTaskDoc | null;
  member: JoinMemberDoc | null;
  uid: string;
}): JoinDecision {
  const { inviteCode, invite, taskId, task, member, uid } = input;

  if (!invite || invite.active !== true || invite.taskId !== taskId) return { kind: "invalid" };
  if (!task) return { kind: "invalid" };

  /*
    雙向比對。少了這一步，「偽造一份 invites 文件指向別人的 taskId」就能
    把整個修法繞過去 —— callable 會老老實實照著那份文件把人加進去。

    規則那邊也擋了偽造（建立邀請要是任務的 owner），但那是另一個檔案裡的
    另一條規則。這裡再對一次的成本是零：task 文件本來就要讀。
  */
  if (task.inviteCode !== inviteCode) return { kind: "invalid" };

  if (task.status !== "active") return { kind: "inactive-task" };

  const memberIds = Array.isArray(task.memberIds) ? task.memberIds : [];
  const listed = memberIds.includes(uid);
  // 舊的 member 文件沒有 active 欄位，那時候的成員都是有效的。
  const activeMember = member !== null && member.active !== false;

  if (listed && activeMember) return { kind: "already" };

  /*
    memberIds 與 member 文件會不同步：被移除的人是 memberIds 拿掉、member
    文件留著（軟刪）。所以「要不要建文件」跟「人數要不要加一」是兩個獨立的
    問題，不能共用一個布林 —— 共用的話，被移除過的人重新加入會加不到人數。
  */
  return { kind: "join", isNew: member === null, countsUp: !listed };
}
