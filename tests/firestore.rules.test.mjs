/**
 * Firestore Security Rules 測試。
 *
 * 跑法：npm run test:rules
 * 需要 Java（Firestore emulator 是 Java 程式）。
 */
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "demo-splitflow";
const OWNER = "uid_owner";
const ADMIN = "uid_admin";
const MEMBER = "uid_member";
const OTHER = "uid_other";
const OUTSIDER = "uid_outsider";
const TASK = "task1";
const CODE = "invitecode1";

let testEnv;
let passed = 0;
let failed = 0;

function as(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function anon() {
  return testEnv.unauthenticatedContext().firestore();
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

const ROLES = [
  [OWNER, "owner"],
  [ADMIN, "admin"],
  [MEMBER, "member"],
  [OTHER, "member"]
];

/** 一個四人任務，MEMBER 先付了一筆四人均分的支出。 */
async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();

    await setDoc(doc(db, "tasks", TASK), {
      name: "曼谷旅行",
      ownerId: OWNER,
      adminIds: [OWNER, ADMIN],
      memberIds: [OWNER, ADMIN, MEMBER, OTHER],
      defaultCurrency: "TWD",
      startDate: null,
      endDate: null,
      status: "active",
      inviteCode: CODE,

      memberCount: 4,
      expenseCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    for (const [uid, role] of ROLES) {
      await setDoc(doc(db, "tasks", TASK, "members", uid), {
        uid,
        nickname: uid,
        role,
        joinedAt: new Date(),
        active: true
      });
    }

    await setDoc(doc(db, "tasks", TASK, "expenses", "e1"), {
      title: "晚餐",
      category: "food",
      amount: 10000,
      currency: "TWD",
      rate: 1,
      baseAmount: 10000,
      paidBy: MEMBER,
      splitMode: "even",
      splits: { [OWNER]: 2500, [ADMIN]: 2500, [MEMBER]: 2500, [OTHER]: 2500 },
      createdBy: MEMBER,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 自訂分攤與匯率之前的舊格式，用來確認舊支出仍然編輯得動。
    await setDoc(doc(db, "tasks", TASK, "expenses", "legacy"), {
      title: "舊格式午餐",
      category: "food",
      amount: 8000,
      currency: "TWD",
      paidBy: MEMBER,
      splitMemberIds: [MEMBER, OTHER],
      createdBy: MEMBER,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await setDoc(doc(db, "invites", CODE), {
      taskId: TASK,
      taskName: "曼谷旅行",
      defaultCurrency: "TWD",
      startDate: null,
      endDate: null,
      createdBy: OWNER,
      active: true,
      createdAt: new Date()
    });
  });
}

const REPORT = "report1";

/** 一份合法的報告內容，測試建立與塞資料共用。 */
function reportData(overrides = {}) {
  return {
    taskName: "曼谷旅行",
    currency: "TWD",
    startDate: null,
    endDate: null,
    days: 5,
    memberCount: 4,
    expenseCount: 1,
    total: 10000,
    perPerson: 2500,
    categories: [],
    places: [],
    mapPath: null,
    active: true,
    ...overrides
  };
}

/** 直接塞一份報告進資料庫，不經過 rules。 */
async function seedReport(active = true) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "tasks", TASK, "reports", REPORT), {
      ...reportData({ active }),
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });
}

/** 直接改資料庫做出「已封存」的狀態，不經過 rules。 */
async function archiveTask() {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), "tasks", TASK), { status: "archived" });
  });
}

/** 直接改資料庫做出「已被移除」的狀態，不經過 rules。 */
async function removeFromTask(uid) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await updateDoc(doc(db, "tasks", TASK, "members", uid), { active: false, role: "member" });
    await updateDoc(doc(db, "tasks", TASK), {
      memberIds: arrayRemove(uid),
      adminIds: arrayRemove(uid),
      memberCount: increment(-1)
    });
  });
}

function newExpense(overrides = {}) {
  return {
    title: "計程車",
    category: "transport",
    amount: 25000,
    currency: "TWD",
    rate: 1,
    baseAmount: 25000,
    paidBy: MEMBER,
    splitMode: "even",
    splits: { [OWNER]: 12500, [MEMBER]: 12500 },
    place: null,
    receipt: null,
    createdBy: MEMBER,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function editedExpense(overrides = {}) {
  return {
    title: "晚餐（改）",
    category: "food",
    amount: 12000,
    currency: "TWD",
    rate: 1,
    baseAmount: 12000,
    paidBy: MEMBER,
    splitMode: "even",
    splits: { [OWNER]: 3000, [ADMIN]: 3000, [MEMBER]: 3000, [OTHER]: 3000 },
    place: null,
    receipt: null,
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });

  // --- 任務讀取 ---
  await test("成員可以讀任務", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(as(MEMBER), "tasks", TASK)));
  });

  await test("非成員不能讀任務", async () => {
    await seed();
    await assertFails(getDoc(doc(as(OUTSIDER), "tasks", TASK)));
  });

  // 任務列表頁走的是 collection query（list），跟上面的 get 是不同的規則評估。
  await test("成員可以用 array-contains 查自己的任務列表", async () => {
    await seed();
    const db = as(MEMBER);
    await assertSucceeds(
      getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", MEMBER)))
    );
  });

  await test("非成員查任務列表只會拿到空的，不會被擋", async () => {
    await seed();
    const db = as(OUTSIDER);
    await assertSucceeds(
      getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", OUTSIDER)))
    );
  });

  await test("不能撈整個 tasks collection", async () => {
    await seed();
    await assertFails(getDocs(collection(as(MEMBER), "tasks")));
  });

  await test("不能查別人的任務列表", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(
      getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", OWNER)))
    );
  });

  // 完整重現任務列表頁：先查任務，再逐一讀自己的 member 文件拿角色。
  await test("任務列表頁的完整流程跑得通", async () => {
    await seed();
    const db = as(MEMBER);
    const tasks = await getDocs(query(collection(db, "tasks"), where("memberIds", "array-contains", MEMBER)));
    for (const task of tasks.docs) {
      await assertSucceeds(getDoc(doc(db, "tasks", task.id, "members", MEMBER)));
    }
  });

  // --- 任務更新與 owner 保護 ---
  await test("admin 可以改任務名稱", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(ADMIN), "tasks", TASK), { name: "清邁旅行" }));
  });

  await test("一般成員不能改任務名稱", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK), { name: "清邁旅行" }));
  });

  await test("admin 不能把 ownerId 換成自己", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { ownerId: ADMIN }));
  });

  await test("owner 可以封存任務", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "archived" }));
  });

  await test("owner 可以解除封存", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "active" }));
  });

  await test("owner 可以刪除（軟刪除）", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "deleted" }));
  });

  // 這條最重要：updatesTaskAsAdmin 本來就讓 admin 改得動任務欄位，
  // 不堵住那個後門的話「只有 owner」就是假的。
  await test("admin 不能封存或刪除任務 —— 那是 owner 專屬", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { status: "archived" }));
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { status: "deleted" }));
  });

  await test("一般成員不能改任務狀態", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK), { status: "archived" }));
  });

  await test("改狀態時不能順便改別的欄位", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(as(OWNER), "tasks", TASK), { status: "archived", name: "偷改" })
    );
  });

  await test("狀態只能是那三個值", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "zombie" }));
  });

  await test("封存後不能新增支出 —— 唯讀要在規則層擋住，不是只藏按鈕", async () => {
    await seed();
    await archiveTask();
    await assertFails(setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense()));
  });

  await test("封存後不能修改既有支出", async () => {
    await seed();
    await archiveTask();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("封存後不能刪除支出", async () => {
    await seed();
    await archiveTask();
    await assertFails(deleteDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1")));
  });

  await test("封存後仍然看得到支出 —— 封存的重點就是留著查", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(getDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1")));
  });

  await test("封存後不能單獨改 expenseCount", async () => {
    await seed();
    await archiveTask();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK), { expenseCount: increment(1) }));
  });

  await test("封存後不能有人加入這個任務", async () => {
    await seed();
    await archiveTask();
    await assertFails(
      setDoc(doc(as(OUTSIDER), "tasks", TASK, "members", OUTSIDER), {
        uid: OUTSIDER,
        nickname: OUTSIDER,
        role: "member",
        joinedAt: serverTimestamp(),
        active: true
      })
    );
  });

  await test("解除封存之後又可以記帳了", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "active" }));
    await assertSucceeds(setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense()));
  });

  // --- 公開旅費報告 ---
  await test("未登入的人可以讀公開的報告 —— 這就是這個功能的重點", async () => {
    await seed();
    await seedReport(true);
    await assertSucceeds(getDoc(doc(anon(), "tasks", TASK, "reports", REPORT)));
  });

  // 這條是「可撤銷」的唯一證明。沒有它，撤銷就只是介面上的錯覺。
  await test("撤銷之後未登入的人就讀不到了", async () => {
    await seed();
    await seedReport(false);
    await assertFails(getDoc(doc(anon(), "tasks", TASK, "reports", REPORT)));
  });

  await test("成員讀得到已撤銷的報告，才能重新開啟", async () => {
    await seed();
    await seedReport(false);
    await assertSucceeds(getDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT)));
  });

  await test("owner 可以產生報告", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT), {
        ...reportData(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("admin 不能產生報告 —— 公開別人的消費資料只有 owner 能決定", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(ADMIN), "tasks", TASK, "reports", REPORT), {
        ...reportData({ taskName: "偷發布" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("owner 可以撤銷報告", async () => {
    await seed();
    await seedReport(true);
    await assertSucceeds(
      updateDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT), { active: false })
    );
  });

  await test("一般成員不能撤銷報告", async () => {
    await seed();
    await seedReport(true);
    await assertFails(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "reports", REPORT), { active: false })
    );
  });

  await test("未登入的人不能列出報告集合 —— 只能靠連結拿到指定的那一份", async () => {
    await seed();
    await seedReport(true);
    await assertFails(getDocs(collection(anon(), "tasks", TASK, "reports")));
  });

  await test("admin 不能把 owner 踢出 memberIds", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { memberIds: arrayRemove(OWNER) }));
  });

  await test("admin 不能把 owner 移出 adminIds", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { adminIds: arrayRemove(OWNER) }));
  });

  // --- 角色升降 ---
  await test("admin 可以把 member 升為 admin", async () => {
    await seed();
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", MEMBER), { role: "admin" });
    batch.update(doc(db, "tasks", TASK), { adminIds: arrayUnion(MEMBER), updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  await test("admin 可以把 admin 降為 member", async () => {
    await seed();
    const db = as(OWNER);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", ADMIN), { role: "member" });
    batch.update(doc(db, "tasks", TASK), { adminIds: arrayRemove(ADMIN), updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  await test("admin 不能改 owner 的角色", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK, "members", OWNER), { role: "member" }));
  });

  await test("admin 不能把別人升成 owner", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK, "members", MEMBER), { role: "owner" }));
  });

  await test("一般成員不能改別人的角色", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "members", OTHER), { role: "admin" }));
  });

  await test("一般成員不能把自己升為 admin", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "members", MEMBER), { role: "admin" }));
  });

  // --- 移除成員 ---
  await test("admin 可以移除一般成員", async () => {
    await seed();
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", OTHER), { active: false, role: "member" });
    batch.update(doc(db, "tasks", TASK), {
      memberIds: arrayRemove(OTHER),
      adminIds: arrayRemove(OTHER),
      memberCount: increment(-1),
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
  });

  await test("admin 不能移除 owner", async () => {
    await seed();
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", OWNER), { active: false, role: "member" });
    batch.update(doc(db, "tasks", TASK), {
      memberIds: arrayRemove(OWNER),
      memberCount: increment(-1),
      updatedAt: serverTimestamp()
    });
    await assertFails(batch.commit());
  });

  await test("一般成員不能移除別人", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "members", OTHER), { active: false }));
  });

  await test("member 文件不能被刪除，只能標成 inactive", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as(OWNER), "tasks", TASK, "members", OTHER)));
  });

  await test("admin 不能改 member 文件的 uid", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(OWNER), "tasks", TASK, "members", OTHER), { uid: "換一個" }));
  });

  // --- 被移除之後 ---
  await test("被移除的人不能再讀任務", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertFails(getDoc(doc(as(OTHER), "tasks", TASK)));
  });

  await test("被移除的人不能再列出成員", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertFails(getDocs(collection(as(OTHER), "tasks", TASK, "members")));
  });

  await test("被移除的人不能再列出支出", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertFails(getDocs(collection(as(OTHER), "tasks", TASK, "expenses")));
  });

  await test("被移除的人仍讀得到自己的 member 文件（router guard 要用）", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertSucceeds(getDoc(doc(as(OTHER), "tasks", TASK, "members", OTHER)));
  });

  await test("被移除的人可以用邀請連結重新加入", async () => {
    await seed();
    await removeFromTask(OTHER);
    const db = as(OTHER);
    await assertSucceeds(
      runTransaction(db, async tx => {
        const memberRef = doc(db, "tasks", TASK, "members", OTHER);
        await tx.get(memberRef);
        tx.update(memberRef, { active: true, nickname: "重新加入" });
        tx.update(doc(db, "tasks", TASK), {
          memberIds: arrayUnion(OTHER),
          memberCount: increment(1),
          updatedAt: serverTimestamp()
        });
      })
    );
  });

  await test("重新加入時不能順便把自己升成 admin", async () => {
    await seed();
    await removeFromTask(OTHER);
    const db = as(OTHER);
    await assertFails(
      runTransaction(db, async tx => {
        const memberRef = doc(db, "tasks", TASK, "members", OTHER);
        await tx.get(memberRef);
        tx.update(memberRef, { active: true, role: "admin" });
        tx.update(doc(db, "tasks", TASK), {
          memberIds: arrayUnion(OTHER),
          memberCount: increment(1),
          updatedAt: serverTimestamp()
        });
      })
    );
  });

  await test("還在任務裡的人不能自己把 active 改來改去", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "members", MEMBER), { active: true }));
  });

  // --- 支出 ---
  await test("成員可以新增支出並同時加 expenseCount", async () => {
    await seed();
    const db = as(MEMBER);
    const batch = writeBatch(db);
    batch.set(doc(db, "tasks", TASK, "expenses", "e2"), newExpense());
    batch.update(doc(db, "tasks", TASK), { expenseCount: increment(1), updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  await test("新增支出時不能順便改任務名稱", async () => {
    await seed();
    const db = as(MEMBER);
    const batch = writeBatch(db);
    batch.set(doc(db, "tasks", TASK, "expenses", "e2"), newExpense());
    batch.update(doc(db, "tasks", TASK), { expenseCount: increment(1), name: "偷改" });
    await assertFails(batch.commit());
  });

  await test("金額必須是整數，浮點數會被擋", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ amount: 100.5 })));
  });

  await test("金額不能是 0 或負數", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ amount: 0 })));
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e3"), newExpense({ amount: -100 })));
  });

  await test("分類必須是六種之一", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ category: "咖啡" })));
  });

  await test("不能建立 createdBy 是別人的支出", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ createdBy: OWNER })));
  });

  await test("paidBy 不能是非成員", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ paidBy: OUTSIDER })));
  });

  await test("splits 不能包含非成員", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ splits: { [MEMBER]: 12500, [OUTSIDER]: 12500 } })
      )
    );
  });

  await test("splits 不能是空的", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ splits: {} })));
  });

  await test("成員可以建立帶收據的支出", async () => {
    await seed();
    const db = as(MEMBER);
    await assertSucceeds(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ receipt: { path: null, localId: "local-1" } })
      )
    );
  });

  await test("收據欄位型別不對要被擋下來", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ receipt: { path: 123, localId: "local-1" } })
      )
    );
  });

  // 這條特別重要：它證明補傳時那次只寫 receipt 的部分 update 能通過
  // validExpenseShape()，也就是規則不需要為了補傳而放寬。
  await test("上傳完成後把 receipt 換成 Storage 路徑，只改這一個欄位也要放行", async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), {
        receipt: { path: "tasks/task1/expenses/e1/receipt.jpg", localId: null }
      })
    );
  });

  await test("沒有管理權的成員不能動別人支出的收據", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(as(OTHER), "tasks", TASK, "expenses", "e1"), {
        receipt: { path: "tasks/task1/expenses/e1/receipt.jpg", localId: null }
      })
    );
  });

  await test("splitMode 只能是 even 或 custom", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(
      setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ splitMode: "weighted" }))
    );
  });

  await test("匯率必須大於 0", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ rate: 0 })));
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e3"), newExpense({ rate: -1 })));
  });

  await test("換算後金額必須是正整數", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "expenses", "e2"), newExpense({ baseAmount: 0 })));
    await assertFails(
      setDoc(doc(db, "tasks", TASK, "expenses", "e3"), newExpense({ baseAmount: 250.5 }))
    );
  });

  await test("外幣支出帶小數匯率可以存", async () => {
    await seed();
    const db = as(MEMBER);
    await assertSucceeds(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ currency: "THB", amount: 50000, rate: 0.923456, baseAmount: 46172 })
      )
    );
  });

  await test("可以帶完整的 Google 地點", async () => {
    await seed();
    await assertSucceeds(
      setDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "e2"),
        newExpense({
          place: {
            name: "泰式船麵",
            address: "曼谷市中心某條路 12 號",
            lat: 13.7563,
            lng: 100.5018,
            placeId: "ChIJ_fake_place_id"
          }
        })
      )
    );
  });

  await test("沒有座標的純文字地點也可以存", async () => {
    await seed();
    await assertSucceeds(
      setDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "e2"),
        newExpense({ place: { name: "路邊攤", address: null, lat: null, lng: null, placeId: null } })
      )
    );
  });

  await test("地點有填就不能是空名稱", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ place: { name: "", address: null, lat: null, lng: null, placeId: null } })
      )
    );
    await assertFails(
      setDoc(doc(db, "tasks", TASK, "expenses", "e3"), newExpense({ place: "台北" }))
    );
  });

  await test("自訂分攤可以每人不同金額", async () => {
    await seed();
    const db = as(MEMBER);
    await assertSucceeds(
      setDoc(
        doc(db, "tasks", TASK, "expenses", "e2"),
        newExpense({ splitMode: "custom", splits: { [OWNER]: 5000, [MEMBER]: 20000 } })
      )
    );
  });

  await test("建立者可以改自己的支出", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("admin 可以改別人的支出", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(ADMIN), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("先付的人可以改不是自己建立的支出", async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), "tasks", TASK, "expenses", "e1"), { createdBy: OWNER });
    });
    await assertSucceeds(updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("不相干的一般成員不能改別人的支出", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(OTHER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("不能改支出的 createdBy", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense({ createdBy: OTHER }))
    );
  });

  await test("已離開的成員可以留在原本就有他的支出裡", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertSucceeds(updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("編輯支出時不能塞進陌生 uid", async () => {
    await seed();
    await assertFails(
      updateDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "e1"),
        editedExpense({ splits: { [MEMBER]: 6000, [OUTSIDER]: 6000 } })
      )
    );
  });

  await test("舊格式支出可以被改存成新格式", async () => {
    await seed();
    await assertSucceeds(
      updateDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "legacy"),
        editedExpense({ amount: 8000, baseAmount: 8000, splits: { [MEMBER]: 4000, [OTHER]: 4000 } })
      )
    );
  });

  await test("舊格式支出裡已離開的成員也留得住", async () => {
    await seed();
    await removeFromTask(OTHER);
    await assertSucceeds(
      updateDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "legacy"),
        editedExpense({ amount: 8000, baseAmount: 8000, splits: { [MEMBER]: 4000, [OTHER]: 4000 } })
      )
    );
  });

  await test("非成員不能讀支出", async () => {
    await seed();
    await assertFails(getDoc(doc(as(OUTSIDER), "tasks", TASK, "expenses", "e1")));
  });

  // --- 已付款確認 ---
  function newPayment(overrides = {}) {
    return {
      from: MEMBER,
      to: OWNER,
      amount: 5000,
      currency: "TWD",
      status: "pending",
      createdBy: MEMBER,
      confirmedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides
    };
  }

  async function seedPayment(overrides = {}) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "tasks", TASK, "payments", "p1"), {
        from: MEMBER,
        to: OWNER,
        amount: 5000,
        currency: "TWD",
        status: "pending",
        createdBy: MEMBER,
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
      });
    });
  }

  await test("付款人可以記錄自己付的款，狀態是待確認", async () => {
    await seed();
    await assertSucceeds(setDoc(doc(as(MEMBER), "tasks", TASK, "payments", "p1"), newPayment()));
  });

  await test("收款人自己記可以直接算已確認", async () => {
    await seed();
    await assertSucceeds(
      setDoc(
        doc(as(OWNER), "tasks", TASK, "payments", "p1"),
        newPayment({ from: MEMBER, to: OWNER, createdBy: OWNER, status: "confirmed" })
      )
    );
  });

  await test("付款人不能把自己付的款直接記成已確認", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "payments", "p1"), newPayment({ status: "confirmed" }))
    );
  });

  await test("不能記錄跟自己無關的付款", async () => {
    await seed();
    await assertFails(
      setDoc(
        doc(as(OTHER), "tasks", TASK, "payments", "p1"),
        newPayment({ from: MEMBER, to: OWNER, createdBy: OTHER })
      )
    );
  });

  await test("admin 可以代記別人之間的付款", async () => {
    await seed();
    await assertSucceeds(
      setDoc(
        doc(as(ADMIN), "tasks", TASK, "payments", "p1"),
        newPayment({ from: MEMBER, to: OWNER, createdBy: ADMIN })
      )
    );
  });

  await test("付款金額必須是正整數", async () => {
    await seed();
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, "tasks", TASK, "payments", "p1"), newPayment({ amount: 0 })));
    await assertFails(setDoc(doc(db, "tasks", TASK, "payments", "p2"), newPayment({ amount: 12.5 })));
  });

  await test("付款人跟收款人不能是同一個人", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "payments", "p1"), newPayment({ from: MEMBER, to: MEMBER }))
    );
  });

  await test("收款人可以確認收到", async () => {
    await seed();
    await seedPayment();
    await assertSucceeds(
      updateDoc(doc(as(OWNER), "tasks", TASK, "payments", "p1"), {
        status: "confirmed",
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("付款人不能自己確認收到", async () => {
    await seed();
    await seedPayment();
    await assertFails(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "payments", "p1"), {
        status: "confirmed",
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("不相干的成員不能確認別人的付款", async () => {
    await seed();
    await seedPayment();
    await assertFails(
      updateDoc(doc(as(OTHER), "tasks", TASK, "payments", "p1"), {
        status: "confirmed",
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("確認時不能順便改金額", async () => {
    await seed();
    await seedPayment();
    await assertFails(
      updateDoc(doc(as(OWNER), "tasks", TASK, "payments", "p1"), {
        status: "confirmed",
        amount: 999999,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("已確認的付款不能再被改回待確認", async () => {
    await seed();
    await seedPayment({ status: "confirmed" });
    await assertFails(
      updateDoc(doc(as(OWNER), "tasks", TASK, "payments", "p1"), {
        status: "pending",
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("付款人與收款人都可以刪掉付款紀錄", async () => {
    await seed();
    await seedPayment();
    await assertSucceeds(deleteDoc(doc(as(MEMBER), "tasks", TASK, "payments", "p1")));
    await seedPayment();
    await assertSucceeds(deleteDoc(doc(as(OWNER), "tasks", TASK, "payments", "p1")));
  });

  await test("不相干的成員不能刪付款紀錄", async () => {
    await seed();
    await seedPayment();
    await assertFails(deleteDoc(doc(as(OTHER), "tasks", TASK, "payments", "p1")));
  });

  await test("非成員讀不到付款紀錄", async () => {
    await seed();
    await seedPayment();
    await assertFails(getDocs(collection(as(OUTSIDER), "tasks", TASK, "payments")));
  });

  await test("成員都看得到付款紀錄", async () => {
    await seed();
    await seedPayment();
    await assertSucceeds(getDocs(collection(as(OTHER), "tasks", TASK, "payments")));
  });

  // --- 結算紀錄 ---
  function newSnapshot(overrides = {}) {
    return {
      currency: "TWD",
      total: 10000,
      paidTotal: 0,
      expenseCount: 1,
      balances: [
        { uid: MEMBER, paid: 10000, owed: 2500, balance: 7500 },
        { uid: OWNER, paid: 0, owed: 2500, balance: -2500 }
      ],
      transfers: [{ from: OWNER, to: MEMBER, amount: 2500 }],
      memberNames: { [MEMBER]: "小明", [OWNER]: "小華" },
      note: "回國當天結算",
      createdBy: OWNER,
      createdAt: serverTimestamp(),
      ...overrides
    };
  }

  async function seedSnapshot(overrides = {}) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "tasks", TASK, "settlements", "s1"), {
        ...newSnapshot(),
        createdAt: new Date(),
        ...overrides
      });
    });
  }

  await test("admin 可以存結算紀錄", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(as(ADMIN), "tasks", TASK, "settlements", "s1"), newSnapshot({ createdBy: ADMIN }))
    );
  });

  await test("一般成員不能存結算紀錄", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "settlements", "s1"), newSnapshot({ createdBy: MEMBER }))
    );
  });

  await test("不能掛在別人名下建立結算紀錄", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(ADMIN), "tasks", TASK, "settlements", "s1"), newSnapshot({ createdBy: OWNER }))
    );
  });

  await test("結算紀錄存下來就不能修改", async () => {
    await seed();
    await seedSnapshot();
    await assertFails(
      updateDoc(doc(as(OWNER), "tasks", TASK, "settlements", "s1"), { total: 999999 })
    );
    await assertFails(updateDoc(doc(as(OWNER), "tasks", TASK, "settlements", "s1"), { note: "改備註" }));
  });

  await test("admin 可以刪掉結算紀錄", async () => {
    await seed();
    await seedSnapshot();
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "tasks", TASK, "settlements", "s1")));
  });

  await test("一般成員不能刪結算紀錄", async () => {
    await seed();
    await seedSnapshot();
    await assertFails(deleteDoc(doc(as(MEMBER), "tasks", TASK, "settlements", "s1")));
  });

  await test("成員都看得到結算紀錄", async () => {
    await seed();
    await seedSnapshot();
    await assertSucceeds(getDocs(collection(as(MEMBER), "tasks", TASK, "settlements")));
  });

  await test("非成員看不到結算紀錄", async () => {
    await seed();
    await seedSnapshot();
    await assertFails(getDocs(collection(as(OUTSIDER), "tasks", TASK, "settlements")));
  });

  await test("結算紀錄的欄位型別要對", async () => {
    await seed();
    const db = as(ADMIN);
    await assertFails(
      setDoc(doc(db, "tasks", TASK, "settlements", "s1"), newSnapshot({ createdBy: ADMIN, total: "一萬" }))
    );
    await assertFails(
      setDoc(doc(db, "tasks", TASK, "settlements", "s2"), newSnapshot({ createdBy: ADMIN, balances: "空" }))
    );
    await assertFails(
      setDoc(
        doc(db, "tasks", TASK, "settlements", "s3"),
        newSnapshot({ createdBy: ADMIN, note: "超".repeat(201) })
      )
    );
  });

  // --- 邀請連結 ---
  await test("未登入者可以讀有效的邀請", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(anon(), "invites", CODE)));
  });

  // 邀請文件建立後就固定了，沒有停用或重新產生的功能，所以誰都不能改也不能刪。
  await test("admin 也不能改邀請文件", async () => {
    await seed();
    const db = as(ADMIN);
    await assertFails(updateDoc(doc(db, "invites", CODE), { active: false }));
    await assertFails(updateDoc(doc(db, "invites", CODE), { taskId: "別的任務" }));
  });

  await test("一般成員不能改邀請文件", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "invites", CODE), { active: false }));
  });

  await test("邀請文件不能被刪除", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as(OWNER), "invites", CODE)));
  });

  await test("不能建立掛在別人名下的邀請", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(ADMIN), "invites", "newcode"), {
        taskId: TASK,
        taskName: "曼谷旅行",
        defaultCurrency: "TWD",
        startDate: null,
        endDate: null,
        createdBy: OWNER,
        active: true,
        createdAt: serverTimestamp()
      })
    );
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
