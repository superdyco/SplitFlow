import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { CreateTaskInput, Task } from "@/types/task";
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
    inviteActive: true,
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

export async function listUserTasks(uid: string): Promise<Task[]> {
  const snap = await getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", uid)));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }) as Task);
}
