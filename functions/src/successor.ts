/**
 * 帳號被刪除的 owner，任務要交給誰。
 *
 * 回傳 null 代表**沒有人可以接手**，呼叫端應該把整個任務刪掉 —— 那時候留著
 * 任務也沒有任何真人看得到。
 *
 * `members` 必須已依 `joinedAt` 遞增排序。排序留給呼叫端，因為那是 Firestore
 * 查詢就能做完的事，拉進來只會讓這支函式需要一個它不該知道的欄位。
 */
export interface SuccessorCandidate {
  uid: string;
  active: boolean;
  virtual: boolean;
}

export function pickSuccessor(
  adminIds: string[],
  members: SuccessorCandidate[],
  leavingUid: string
): string | null {
  const eligible = members.filter(
    member => member.uid !== leavingUid && member.active && !member.virtual
  );

  // adminIds 可能列到已經不在成員名單裡的人（舊資料、寫入失敗）。挑一個不存在
  // 的人接手，任務會直接壞掉而且沒有人能修 —— 所以要跟成員名單交叉比對。
  const admin = eligible.find(member => (adminIds ?? []).includes(member.uid));
  if (admin) return admin.uid;

  // 沒有其他 admin 就交給最早加入的真人。members 已經排好序。
  return eligible[0]?.uid ?? null;
}
