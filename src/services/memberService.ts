import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { AssignableRole, TaskMember } from "@/types/member";
import type { UserProfile } from "@/types/user";

export async function getTaskMember(taskId: string, uid: string): Promise<TaskMember | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "members", uid));
  return snap.exists() ? (snap.data() as TaskMember) : null;
}

/** 回傳所有 member 文件，包含被移除的（active: false），這樣舊支出還查得到暱稱。 */
export async function listTaskMembers(taskId: string): Promise<TaskMember[]> {
  const snap = await getDocs(query(collection(db, "tasks", taskId, "members"), orderBy("joinedAt", "asc")));
  return snap.docs.map(item => item.data() as TaskMember);
}

export async function joinTask(taskId: string, profile: UserProfile): Promise<void> {
  await runTransaction(db, async transaction => {
    const taskRef = doc(db, "tasks", taskId);
    const memberRef = doc(db, "tasks", taskId, "members", profile.uid);
    const memberSnap = await transaction.get(memberRef);
    const existing = memberSnap.exists() ? (memberSnap.data() as TaskMember) : null;

    if (existing?.active) return;

    if (existing) {
      // 被移除過的成員重新用邀請連結加入，沿用原本的 member 文件保住角色與加入時間。
      transaction.update(memberRef, { active: true, nickname: profile.nickname });
    } else {
      transaction.set(memberRef, {
        uid: profile.uid,
        nickname: profile.nickname,
        role: "member",
        joinedAt: serverTimestamp(),
        active: true
      });
    }

    transaction.update(taskRef, {
      memberIds: arrayUnion(profile.uid),
      memberCount: increment(1),
      updatedAt: serverTimestamp()
    });
  });
}

/** 升級為 admin 或降級為 member，member 文件與 task.adminIds 一起改。 */
export async function setMemberRole(taskId: string, uid: string, role: AssignableRole): Promise<void> {
  const batch = writeBatch(db);

  batch.update(doc(db, "tasks", taskId, "members", uid), { role });
  batch.update(doc(db, "tasks", taskId), {
    adminIds: role === "admin" ? arrayUnion(uid) : arrayRemove(uid),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
}

/**
 * 移除成員。member 文件留著並標成 active: false，這樣既有支出仍查得到暱稱，
 * 但從 task.memberIds 拿掉之後 Security Rules 就不再讓他讀取這個任務。
 */
export async function removeMember(taskId: string, uid: string): Promise<void> {
  const batch = writeBatch(db);

  // 一起降回 member，之後若重新加入不會拿著 admin 角色但不在 adminIds 裡。
  batch.update(doc(db, "tasks", taskId, "members", uid), { active: false, role: "member" });
  batch.update(doc(db, "tasks", taskId), {
    memberIds: arrayRemove(uid),
    adminIds: arrayRemove(uid),
    memberCount: increment(-1),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
}
