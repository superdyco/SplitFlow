/**
 * 種子腳本共用的機制。資料（成員、行程、支出）留在各自的腳本裡，
 * 這裡只放「怎麼把一份行程寫成合法的 Firestore 資料」。
 *
 * 為什麼抽出來：第二份種子（越南 100 筆）出現時，組裝、驗證、dry-run 這
 * 兩百多行如果用複製的，之後改了規則（例如 validExpenseShape 多一個欄位）
 * 就要記得改兩份 —— 忘掉的那份會安靜地產出 App 改不動的資料。
 * 資料不抽，因為兩趟旅程本來就該長得不一樣。
 *
 * 走 firebase-admin，會繞過 Security Rules；所以 validate() 逐筆比對
 * `firestore.rules` 的 validExpenseShape()，寫得進去但 App 改不動的支出
 * 是這份資料最沒有價值的失敗方式。
 */
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------- 參數

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/** 兩份腳本的參數完全一樣：--key、--uid、--nickname、--dry-run。 */
export function parseSeedArgs(scriptName) {
  const dryRun = process.argv.includes("--dry-run");
  const keyPath = arg("key") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const ownerUid = arg("uid") ?? (dryRun ? "dry-run-owner" : null);
  const ownerNickname = arg("nickname") ?? "我";

  if ((!keyPath && !dryRun) || !ownerUid) {
    console.error(`
需要兩個參數：

  --key   服務帳戶金鑰的路徑
          Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
          ** 不要放進 repo，這把金鑰可以讀寫整個專案 **

  --uid   你的 Firebase Auth uid，示範任務會掛在這個帳號下
          Firebase Console → Authentication → 使用者，複製「使用者 UID」

例：
  node scripts/${scriptName} --key C:/keys/splitflow.json --uid abc123... --nickname 阿德

先看資料長什麼樣（不需要金鑰、不寫入任何東西）：
  node scripts/${scriptName} --dry-run
`);
    process.exit(1);
  }

  return { dryRun, keyPath, ownerUid, ownerNickname };
}

// ---------------------------------------------------------------- 金額

/**
 * `src/utils/currency.ts` 的 allocate 複製過來。
 *
 * 種子腳本是 .mjs、那邊是 TypeScript，不轉譯就 import 不了。複製的代價是
 * 兩份會漂移，但這裡只在建立資料時用一次，而且真的漂了也只是示範資料的
 * 尾數差一塊，不影響 App 本身的正確性。
 */
export function allocate(total, weights) {
  if (!weights.length) return [];
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) return allocate(total, weights.map(() => 1));

  const exact = weights.map(w => (total * w) / sum);
  const result = exact.map(Math.floor);
  const remainder = total - result.reduce((acc, v) => acc + v, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; i < remainder; i += 1) result[order[i % order.length].index] += 1;
  return result;
}

/** rate 是「1 單位 from 等於多少 to」，兩邊小數位數不同要各自換算。 */
export function makeConvert(minorUnitsMap) {
  const minor = currency => minorUnitsMap[currency] ?? 2;
  return function convertAmount(amount, from, to, rate) {
    if (from === to) return amount;
    return Math.round((amount / 10 ** minor(from)) * rate * 10 ** minor(to));
  };
}

// ---------------------------------------------------------------- 組裝

/**
 * split 三種寫法：
 *   "all"            全體均分
 *   [uid, uid]       只有這幾個人均分
 *   { uid: 金額 }     自訂分攤，合計必須等於 amount
 */
export function buildSplits(spec, amount, allUids) {
  if (spec && !Array.isArray(spec) && typeof spec === "object") {
    const total = Object.values(spec).reduce((acc, v) => acc + v, 0);
    if (total !== amount) {
      throw new Error(`自訂分攤合計 ${total} 不等於金額 ${amount}`);
    }
    return { splitMode: "custom", splits: spec };
  }

  const uids = spec === "all" ? allUids : spec;
  const shares = allocate(amount, uids.map(() => 1));
  return {
    splitMode: "even",
    splits: Object.fromEntries(uids.map((uid, i) => [uid, shares[i]]))
  };
}

/**
 * createdAt 用消費當天的當地時間，不是現在。
 * 支出列表在同一天內是按 createdAt 排序的，全部設成同一個「現在」的話，
 * 一天之內的順序會變成隨機的，時間軸就看不出行程的先後。
 */
export function dateFor(date, time, index, utcOffsetHours) {
  const [hh, mm] = (time || "23:59").split(":").map(Number);
  const at = new Date(`${date}T00:00:00+${String(utcOffsetHours).padStart(2, "0")}:00`);
  at.setUTCHours(at.getUTCHours() + hh - utcOffsetHours, mm + (index % 60), 0, 0);
  return at;
}

// ---------------------------------------------------------------- 驗證

/** 逐筆比對 firestore.rules 的 validExpenseShape()。 */
export function validate({ expenses, allUids, defaultCurrency, convert }) {
  const problems = [];
  const known = new Set(allUids);

  expenses.forEach((item, index) => {
    const where = `#${index + 1} ${item.date} ${item.title}`;

    if (item.title.length > 60) problems.push(`${where}：標題超過 60 字`);
    if (!Number.isInteger(item.amount) || item.amount <= 0) problems.push(`${where}：金額必須是正整數`);
    if (!(item.rate > 0)) problems.push(`${where}：匯率必須大於 0`);
    if ((item.note ?? "").length > 500) problems.push(`${where}：備註超過 500 字`);
    if (item.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) {
      problems.push(`${where}：時間格式不是 HH:MM`);
    }
    if (!known.has(item.paidBy)) problems.push(`${where}：先付的人不在成員名單裡`);

    const base = convert(item.amount, item.currency, defaultCurrency, item.rate);
    if (!Number.isInteger(base) || base <= 0) problems.push(`${where}：換算後金額必須是正整數`);

    try {
      const { splits } = buildSplits(item.split, item.amount, allUids);
      const keys = Object.keys(splits);
      if (!keys.length) problems.push(`${where}：分攤名單是空的`);
      for (const uid of keys) {
        if (!known.has(uid)) problems.push(`${where}：分攤名單有不存在的成員 ${uid}`);
      }
      const sum = Object.values(splits).reduce((a, v) => a + v, 0);
      if (sum !== item.amount) problems.push(`${where}：分攤合計 ${sum} 不等於金額 ${item.amount}`);
    } catch (err) {
      problems.push(`${where}：${err.message}`);
    }
  });

  return problems;
}

// ---------------------------------------------------------------- 寫入

async function seed({ keyPath, task, members, expenses, payments, convert, utcOffsetHours }) {
  // 動態 import：--dry-run 不該因為沒裝 firebase-admin 就跑不起來。
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

  initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
  const db = getFirestore();

  const ownerUid = members.find(m => m.role === "owner").uid;
  const allUids = members.map(m => m.uid);
  const inviteCode = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");

  const taskRef = db.collection("tasks").doc();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  // Firestore 一個 batch 上限 500 個操作。目前兩份種子分別是 ~50 與 ~125，
  // 離上限還遠；真的超過時這裡要先擋下來，而不是 commit 時默默失敗。
  const operations = 2 + members.length + expenses.length + payments.length;
  if (operations > 500) throw new Error(`一個 batch 只能 500 個操作，現在有 ${operations} 個，要拆批`);

  batch.set(taskRef, {
    name: task.name,
    ownerId: ownerUid,
    adminIds: members.filter(m => m.role === "owner" || m.role === "admin").map(m => m.uid),
    memberIds: allUids,
    defaultCurrency: task.defaultCurrency,
    startDate: task.startDate,
    endDate: task.endDate,
    status: "active",
    inviteCode,
    memberCount: members.length,
    expenseCount: expenses.length,
    createdAt: now,
    updatedAt: now
  });

  batch.set(db.collection("invites").doc(inviteCode), {
    taskId: taskRef.id,
    taskName: task.name,
    defaultCurrency: task.defaultCurrency,
    startDate: task.startDate,
    endDate: task.endDate,
    createdBy: ownerUid,
    active: true,
    createdAt: now
  });

  for (const member of members) {
    batch.set(taskRef.collection("members").doc(member.uid), {
      uid: member.uid,
      nickname: member.nickname,
      role: member.role,
      joinedAt: now,
      active: true
    });
  }

  expenses.forEach((item, index) => {
    const { splitMode, splits } = buildSplits(item.split, item.amount, allUids);
    const baseAmount = convert(item.amount, item.currency, task.defaultCurrency, item.rate);
    const at = Timestamp.fromDate(dateFor(item.date, item.time, index, utcOffsetHours));

    batch.set(taskRef.collection("expenses").doc(), {
      title: item.title,
      category: item.category,
      amount: item.amount,
      currency: item.currency,
      rate: item.rate,
      baseAmount,
      paidBy: item.paidBy,
      splitMode,
      splits,
      place: item.place ? { ...item.place, placeId: null } : null,
      receipt: null,
      note: item.note ?? "",
      date: item.date,
      time: item.time,
      createdBy: item.paidBy,
      createdAt: at,
      updatedAt: at
    });
  });

  for (const payment of payments) {
    batch.set(taskRef.collection("payments").doc(), {
      from: payment.from,
      to: payment.to,
      amount: payment.amount,
      currency: task.defaultCurrency,
      status: payment.status,
      createdBy: payment.createdBy,
      createdAt: now,
      confirmedAt: payment.status === "confirmed" ? now : null,
      updatedAt: now
    });
  }

  await batch.commit();
  return { taskId: taskRef.id, inviteCode };
}

// ---------------------------------------------------------------- 主流程

/** 驗證 → dry-run 或寫入 → 印摘要。兩份腳本的唯一入口。 */
export async function runSeed({ args, task, members, expenses, payments, minorUnits, utcOffsetHours }) {
  const convert = makeConvert(minorUnits);
  const allUids = members.map(m => m.uid);
  const minorOfDefault = minorUnits[task.defaultCurrency] ?? 2;

  const problems = validate({ expenses, allUids, defaultCurrency: task.defaultCurrency, convert });
  if (problems.length) {
    console.error(`資料有 ${problems.length} 個問題，沒有寫入任何東西：\n`);
    problems.forEach(p => console.error("  " + p));
    process.exit(1);
  }

  const baseTotal = expenses.reduce(
    (a, e) => a + convert(e.amount, e.currency, task.defaultCurrency, e.rate),
    0
  );
  const asMajor = cents => (cents / 10 ** minorOfDefault).toLocaleString();

  if (args.dryRun) {
    const byDate = new Map();
    expenses.forEach(item => {
      const base = convert(item.amount, item.currency, task.defaultCurrency, item.rate);
      byDate.set(item.date, (byDate.get(item.date) ?? 0) + base);
    });

    console.log(`\n${task.name}　${task.startDate} ～ ${task.endDate}\n`);
    console.log(`  ${expenses.length} 筆支出全部通過 validExpenseShape() 的檢查\n`);
    for (const [date, total] of [...byDate].sort()) {
      const count = expenses.filter(e => e.date === date).length;
      const label = date < task.startDate ? "出發前" : `Day ${Math.round((Date.parse(date) - Date.parse(task.startDate)) / 86400000) + 1}`;
      console.log(`  ${date}  ${label.padEnd(7)} ${String(count).padStart(2)} 筆   ${task.defaultCurrency} ${asMajor(total).padStart(10)}`);
    }
    console.log(`\n  總額      ${task.defaultCurrency} ${asMajor(baseTotal)}`);
    console.log(`  每人平均  ${task.defaultCurrency} ${Math.round(baseTotal / 10 ** minorOfDefault / members.length).toLocaleString()}`);

    // 每個外幣列一行小計 —— 多幣別是這種資料要測的重點之一。
    for (const currency of [...new Set(expenses.map(e => e.currency))]) {
      if (currency === task.defaultCurrency) continue;
      const sub = expenses.filter(e => e.currency === currency).reduce((a, e) => a + e.amount, 0);
      const minor = minorUnits[currency] ?? 2;
      console.log(`  ${currency} 小計  ${(sub / 10 ** minor).toLocaleString()}`);
    }

    console.log(`  有座標    ${expenses.filter(e => e.place).length} 筆（地圖與報告用）`);
    console.log(`  自訂分攤  ${expenses.filter(e => e.split && !Array.isArray(e.split) && typeof e.split === "object").length} 筆`);
    console.log(`  沒記時間  ${expenses.filter(e => e.time === "").length} 筆（時間軸要排在當天最後）`);
    console.log("\n  這是 --dry-run，沒有寫入任何資料。\n");
    process.exit(0);
  }

  try {
    const { taskId, inviteCode } = await seed({
      keyPath: args.keyPath, task, members, expenses, payments, convert, utcOffsetHours
    });
    console.log(`
建立完成

  任務      ${task.name}
  taskId    ${taskId}
  成員      ${members.length} 人（${members.map(m => m.nickname).join("、")}）
  支出      ${expenses.length} 筆
  總額      ${task.defaultCurrency} ${asMajor(baseTotal)}
  每人平均  ${task.defaultCurrency} ${Math.round(baseTotal / 10 ** minorOfDefault / members.length).toLocaleString()}
  付款      ${payments.length} 筆（${payments.filter(p => p.status === "confirmed").length} 已確認、${payments.filter(p => p.status === "pending").length} 待確認）

  開啟      /tasks/${taskId}
  邀請連結  /join/${inviteCode}

要刪掉的話（子集合要一起，Firestore 沒有 cascade delete）：
  npx firebase firestore:delete tasks/${taskId} --recursive --force
  npx firebase firestore:delete invites/${inviteCode} --force
`);
    process.exit(0);
  } catch (err) {
    console.error("建立失敗：", err.message);
    process.exit(1);
  }
}
