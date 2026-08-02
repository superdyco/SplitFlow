import { FirebaseError } from "firebase/app";
import { doc, getDoc, serverTimestamp, writeBatch, type WriteBatch } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Invite, Task } from "@/types/task";

export function createInviteCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function addInviteToBatch(batch: WriteBatch, inviteCode: string, task: Task, createdBy: string): void {
  batch.set(doc(db, "invites", inviteCode), {
    taskId: task.id,
    taskName: task.name,
    defaultCurrency: task.defaultCurrency,
    startDate: task.startDate,
    endDate: task.endDate,
    createdBy,
    active: true,
    createdAt: serverTimestamp()
  });
}

/**
 * 停用後的 invite 讀取會被 Security Rules 擋下來，對使用者來說跟連結不存在是同一件事，
 * 所以這裡把 permission-denied 也當成 null，讓畫面顯示「連結不存在或已停用」而不是 Firebase 錯誤。
 */
export async function getInvite(inviteCode: string): Promise<Invite | null> {
  try {
    const snap = await getDoc(doc(db, "invites", inviteCode));
    return snap.exists() ? (snap.data() as Invite) : null;
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") return null;
    throw err;
  }
}

/** 停用目前的邀請連結，之後打開連結的人只會看到已停用。 */
export async function deactivateInvite(task: Task): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "invites", task.inviteCode), { active: false });
  batch.update(doc(db, "tasks", task.id), { inviteActive: false, updatedAt: serverTimestamp() });
  await batch.commit();
}

/** 產生新的邀請連結，同時停用舊的，舊連結立刻失效。 */
export async function regenerateInvite(task: Task, createdBy: string): Promise<string> {
  const inviteCode = createInviteCode();
  const batch = writeBatch(db);

  batch.update(doc(db, "invites", task.inviteCode), { active: false });
  addInviteToBatch(batch, inviteCode, task, createdBy);
  batch.update(doc(db, "tasks", task.id), {
    inviteCode,
    inviteActive: true,
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return inviteCode;
}
