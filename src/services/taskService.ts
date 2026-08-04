import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { CreateTaskInput, Task, TaskStatus } from "@/types/task";
import type { UserProfile } from "@/types/user";
import { addInviteToBatch, createInviteCode } from "@/services/inviteService";

export async function createTask(input: CreateTaskInput, owner: UserProfile): Promise<Task> {
  const taskRef = doc(collection(db, "tasks"));
  const inviteCode = createInviteCode();
  const taskData = {
    name: input.name,
    ownerId: owner.uid,
    adminIds: [owner.uid],
    memberIds: [owner.uid],
    defaultCurrency: input.defaultCurrency,
    startDate: input.startDate,
    endDate: input.endDate,
    status: "active" as const,
    inviteCode,
    memberCount: 1,
    expenseCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const task = { id: taskRef.id, ...taskData } as Task;
  const batch = writeBatch(db);

  batch.set(taskRef, taskData);
  batch.set(doc(db, "tasks", taskRef.id, "members", owner.uid), {
    uid: owner.uid,
    nickname: owner.nickname,
    role: "owner",
    joinedAt: serverTimestamp(),
    active: true
  });
  addInviteToBatch(batch, inviteCode, task, owner.uid);
  await batch.commit();
  return task;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const snap = await getDoc(doc(db, "tasks", taskId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Task) : null;
}

/**
 * 不在查詢裡過濾狀態：再加一個條件就要建複合索引，而 `!=` 還會帶來 orderBy 限制。
 * 一個使用者的任務是幾十個等級，載回來用 `partitionTasks` 在前端分堆比較划算。
 */
export async function listUserTasks(uid: string): Promise<Task[]> {
  const snap = await getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", uid)));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }) as Task);
}

/**
 * 封存、解除封存、刪除是同一個動作的三個值，不需要三支函式。
 *
 * 刻意不 await：Firestore 的寫入 promise 要等伺服器確認才 resolve，離線時
 * 永遠不會回來。呼叫端用 settleWrite 決定要等多久。
 */
export function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId), { status, updatedAt: serverTimestamp() });
}
