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
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { AssignableRole, TaskMember } from "@/types/member";
import type { UserProfile } from "@/types/user";
import { generateVirtualMemberId } from "@/utils/virtualMember";
import type { MemberFootprint } from "@/utils/memberFootprint";
import { deleteReceipt } from "@/services/receiptService";

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

/**
 * 建立一個沒有帳號的成員。給長輩這種連 Gmail 都沒有、但確實有參與分帳的人。
 *
 * 用 writeBatch 而不是 joinTask 那種 transaction：id 是現場產生的，不可能
 * 已經存在，所以沒有「先讀再決定」的需要。
 *
 * 回傳合成 id，呼叫端可以拿去預先選成付款人。
 */
export async function createVirtualMember(taskId: string, nickname: string): Promise<string> {
  const uid = generateVirtualMemberId();
  const batch = writeBatch(db);

  batch.set(doc(db, "tasks", taskId, "members", uid), {
    uid,
    nickname,
    role: "member",
    joinedAt: serverTimestamp(),
    active: true,
    virtual: true
  });
  batch.update(doc(db, "tasks", taskId), {
    memberIds: arrayUnion(uid),
    memberCount: increment(1),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return uid;
}

/**
 * 改成員的暱稱。實務上只有虛擬成員會用到 —— 真實成員的暱稱來自個人資料，
 * 他自己改；虛擬成員沒有個人資料，名字是別人替他打的，所以打錯要有得改。
 *
 * 只動 member 文件，不碰 task。規則那邊走 managesMemberAsAdmin()。
 */
/**
 * 把新暱稱同步到這個人所有任務裡的成員文件。
 *
 * 成員文件的 nickname 是加入當下複製的一份副本，不是即時去讀 `users/{uid}`。
 * 副本不能拿掉 —— 刪掉帳號的人與虛擬成員（沒有帳號的長輩）都只有這份名字可讀
 * —— 所以只能在改名時一起更新，否則個人設定改了名，任務裡還是舊的。
 *
 * 兩件事刻意這樣：
 *
 * - 管理員在某個任務裡幫你改過的名字會被蓋掉。個人設定是本人自己改的，以本人為準。
 * - 只掃 `memberIds` 查得到的任務，也就是還在裡面的。離開過的任務找不到（uid 已經
 *   從陣列移除），那邊會留著舊名字配「（已離開）」；要撈到那些得用 collection group
 *   查詢，為了一個離開後才改名的邊角情況多開一組索引與規則，不划算。
 */
export async function syncNicknameToTasks(uid: string, nickname: string): Promise<void> {
  const snap = await getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", uid)));
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.forEach(task => batch.update(doc(db, "tasks", task.id, "members", uid), { nickname }));
  await batch.commit();
}

export async function renameMember(taskId: string, uid: string, nickname: string): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId, "members", uid), { nickname });
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

/** 一個 writeBatch 上限 500 筆寫入，留 50 筆餘裕給同批的計數器更新。 */
const BATCH_LIMIT = 450;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 真的把一個人從任務裡刪掉 —— 連同他的支出與付款。
 *
 * 給「這個人根本不該在這裡」用的：加錯人、測試資料。想保留帳目的話走
 * `removeMember()` 的軟刪。
 *
 * **順序是這支函式的核心。** 分批寫入不是原子的，所以 member 文件放到最後
 * 才刪：中途失敗時那個人還在成員列表上，使用者重按一次就從頭再跑，已刪的
 * 支出查不到、不會重複刪，剩下的繼續刪。反過來先刪 member 文件的話，失敗
 * 會留下「成員不見了但支出還在」，而且再也沒有介面可以重試。
 *
 * 收據是 best-effort —— `deleteReceipt()` 本來就吞掉所有錯誤，孤兒檔案是
 * 既有的設計取捨。
 */
export async function hardDeleteMember(
  taskId: string,
  uid: string,
  footprint: MemberFootprint
): Promise<void> {
  for (const ids of chunk(footprint.expenseIds, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    for (const expenseId of ids) {
      batch.delete(doc(db, "tasks", taskId, "expenses", expenseId));
    }
    batch.update(doc(db, "tasks", taskId), {
      expenseCount: increment(-ids.length),
      updatedAt: serverTimestamp()
    });
    await batch.commit();
  }

  for (const ids of chunk(footprint.paymentIds, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    for (const paymentId of ids) {
      batch.delete(doc(db, "tasks", taskId, "payments", paymentId));
    }
    await batch.commit();
  }

  // 最後才動成員本身。
  const batch = writeBatch(db);
  batch.delete(doc(db, "tasks", taskId, "members", uid));
  batch.update(doc(db, "tasks", taskId), {
    memberIds: arrayRemove(uid),
    adminIds: arrayRemove(uid),
    memberCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  await batch.commit();

  // 帳都刪乾淨了才清照片。失敗不影響結果，孤兒檔案是既有取捨。
  await Promise.all(footprint.expenseIds.map(id => deleteReceipt(taskId, id)));
}
