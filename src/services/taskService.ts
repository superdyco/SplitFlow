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
import { traceDetail } from "@/utils/perfTrace";

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

  /*
    這兩個值是耗時分段唯一解讀得了的線索。沒在追蹤時是 no-op，所以不必在這裡
    判斷「現在有沒有在量」——那種條件散出去之後就再也收不回來了。

    fromCache 尤其關鍵：同樣是 900ms，命中離線快取代表慢在我們自己的程式碼，
    連了伺服器才代表慢在網路。差一個布林值，要改的東西完全不同。
  */
  traceDetail("fromCache", snap.metadata.fromCache);
  traceDetail("taskCount", snap.size);

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

/**
 * 改任務名稱。
 *
 * 規則那邊不用改：`updatesTaskAsAdmin` 沒有 hasOnly，管理員本來就動得了
 * 這個欄位 —— 少的只是介面。
 *
 * **已經發出去的邀請連結會繼續顯示舊名字。** 邀請文件在建立時抄了一份
 * taskName，而規則寫著 `allow update, delete: if false` —— 那是刻意鎖死的。
 * 為了一個名字把邀請變成可寫不划算，而且加入之後看到的就是新名字了。
 */
export function renameTask(taskId: string, name: string): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId), {
    name: name.trim(),
    updatedAt: serverTimestamp()
  });
}
