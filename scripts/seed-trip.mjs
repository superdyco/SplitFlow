/**
 * 建立一筆完整的示範任務：京都・大阪五天四夜，42 筆支出、4 位成員、2 筆付款。
 *
 * 這是開發用的種子資料，不是產品的一部分。存在的理由是報告、時間軸、地圖、
 * 多幣別結算這幾塊要有夠多的真實資料才看得出問題 —— 手動點 42 筆進去
 * 沒有人做得到，而資料太少的話「一半的錢花在吃」這種結論根本不會出現。
 *
 * 走 firebase-admin，會繞過 Security Rules。但產出的每一筆都刻意符合
 * `validExpenseShape()`，所以之後在 App 裡編輯這些支出不會被規則擋下來 ——
 * 種子資料寫得出來、App 卻改不動的話，這份資料就沒有測試價值。
 *
 * 用法：
 *   npm i -D firebase-admin
 *   node scripts/seed-trip.mjs --key <service-account.json> --uid <你的 uid> [--nickname 我]
 *
 * 刪除（子集合要分開刪，Firestore 沒有 cascade delete）：
 *   npx firebase firestore:delete tasks/<taskId> --recursive --force
 */
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------- 參數

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/**
 * --dry-run 完全不碰 Firebase：驗算每一筆的分攤與換算後把結果印出來。
 *
 * 有這個模式是因為金鑰跟寫入權限是兩件不同的事 —— 資料本身對不對，
 * 不該等到有服務帳戶金鑰才知道。也讓你在真的寫進正式資料庫之前先看一眼。
 */
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
  node scripts/seed-trip.mjs --key C:/keys/splitflow.json --uid abc123... --nickname 阿德

先看資料長什麼樣（不需要金鑰、不寫入任何東西）：
  node scripts/seed-trip.mjs --dry-run
`);
  process.exit(1);
}

// ---------------------------------------------------------------- 金額工具

/**
 * `src/utils/currency.ts` 的 allocate 複製過來。
 *
 * 種子腳本是 .mjs、那邊是 TypeScript，不轉譯就 import 不了。複製的代價是
 * 兩份會漂移，但這裡只在建立資料時用一次，而且真的漂了也只是示範資料的
 * 尾數差一塊，不影響 App 本身的正確性。
 */
function allocate(total, weights) {
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

const MINOR_UNITS = { TWD: 2, JPY: 0 };
const minorUnits = currency => MINOR_UNITS[currency] ?? 2;

/** rate 是「1 單位 from 等於多少 to」，兩邊小數位數不同要各自換算。 */
function convertAmount(amount, from, to, rate) {
  if (from === to) return amount;
  return Math.round((amount / 10 ** minorUnits(from)) * rate * 10 ** minorUnits(to));
}

// ---------------------------------------------------------------- 成員

/**
 * uid 一律 `seed-` 開頭：這些是查不到的假帳號，清資料時一眼認得出來。
 * 只有 owner 是真的 uid —— 任務列表靠 `memberIds array-contains uid` 查詢，
 * 沒有真 uid 的話這筆任務你自己會看不到。
 */
const AMEI = "seed-amei";
const XIAOMEI = "seed-xiaomei";
const AJIE = "seed-ajie";

const MEMBERS = [
  { uid: ownerUid, nickname: ownerNickname, role: "owner" },
  { uid: AMEI, nickname: "阿明", role: "admin" },
  { uid: XIAOMEI, nickname: "小美", role: "member" },
  { uid: AJIE, nickname: "阿傑", role: "member" }
];
const ALL = MEMBERS.map(m => m.uid);

const TASK = {
  name: "京都・大阪 五天四夜",
  defaultCurrency: "TWD",
  startDate: "2026-04-08",
  endDate: "2026-04-12"
};

// ---------------------------------------------------------------- 地點

/** 真實座標，地圖與報告的靜態地圖才框得出合理的範圍。 */
const PLACES = {
  kix: { name: "関西国際空港", address: "大阪府泉佐野市泉州空港北1", lat: 34.4342, lng: 135.2328 },
  kyotoStation: { name: "京都駅", address: "京都市下京区東塩小路町", lat: 34.9858, lng: 135.7588 },
  hotel: { name: "四条烏丸", address: "京都市下京区四条通烏丸", lat: 35.0036, lng: 135.7597 },
  pontocho: { name: "先斗町", address: "京都市中京区先斗町通", lat: 35.0067, lng: 135.7708 },
  fushimi: { name: "伏見稲荷大社", address: "京都市伏見区深草藪之内町68", lat: 34.9671, lng: 135.7727 },
  kiyomizu: { name: "清水寺", address: "京都市東山区清水1-294", lat: 34.9949, lng: 135.785 },
  gion: { name: "祇園", address: "京都市東山区祇園町", lat: 35.0037, lng: 135.7752 },
  tenryuji: { name: "天龍寺", address: "京都市右京区嵯峨天龍寺芒ノ馬場町68", lat: 35.016, lng: 135.6738 },
  bamboo: { name: "嵐山竹林の小径", address: "京都市右京区嵯峨小倉山田淵山町", lat: 35.017, lng: 135.6716 },
  togetsukyo: { name: "渡月橋", address: "京都市右京区嵯峨中ノ島町", lat: 35.013, lng: 135.6779 },
  nishiki: { name: "錦市場", address: "京都市中京区西大文字町", lat: 35.005, lng: 135.7649 },
  usj: { name: "ユニバーサル・スタジオ・ジャパン", address: "大阪市此花区桜島2-1-33", lat: 34.6654, lng: 135.4323 },
  dotonbori: { name: "道頓堀", address: "大阪市中央区道頓堀", lat: 34.6687, lng: 135.5012 },
  shinsaibashi: { name: "心斎橋", address: "大阪市中央区心斎橋筋", lat: 34.6723, lng: 135.501 }
};

// ---------------------------------------------------------------- 支出

/**
 * 匯率隨日子變一點，因為匯率是記帳當下鎖進支出的 ——
 * 整趟都用同一個數字的話，就測不出「同一筆帳今天看跟下個月看一樣」這件事。
 */
const RATE = { early: 0.2105, mid: 0.2098, late: 0.2112 };

/**
 * split 三種寫法：
 *   "all"            全體均分
 *   [uid, uid]       只有這幾個人均分
 *   { uid: 金額 }     自訂分攤，合計必須等於 amount
 */
const EXPENSES = [
  // 出發前就付掉的錢。日期早於 startDate 是刻意的 —— 報告的時間軸要處理
  // 「提前買的機票」，不能因此算出 Day 0。
  { date: "2026-03-02", time: "", title: "機票 台北－關西 來回 ×4", category: "transport", amount: 5120000, currency: "TWD", rate: 1, paidBy: ownerUid, split: "all", note: "早鳥票，四個人一起訂" },
  { date: "2026-03-02", time: "", title: "京都住宿訂金", category: "stay", amount: 800000, currency: "TWD", rate: 1, paidBy: AMEI, split: "all" },

  // Day 1
  { date: "2026-04-08", time: "09:40", title: "HARUKA 特急 關西機場→京都", category: "transport", amount: 12400, currency: "JPY", rate: RATE.early, paidBy: ownerUid, split: "all", place: PLACES.kix },
  { date: "2026-04-08", time: "11:20", title: "京都駅 車站便當", category: "food", amount: 3240, currency: "JPY", rate: RATE.early, paidBy: XIAOMEI, split: "all", place: PLACES.kyotoStation },
  { date: "2026-04-08", time: "14:00", title: "飯店住宿尾款", category: "stay", amount: 64000, currency: "JPY", rate: RATE.early, paidBy: AMEI, split: "all", place: PLACES.hotel, note: "四晚，扣掉訂金的餘額" },
  { date: "2026-04-08", time: "15:30", title: "便利商店 飲料零食", category: "food", amount: 1860, currency: "JPY", rate: RATE.early, paidBy: AJIE, split: "all" },
  { date: "2026-04-08", time: "18:30", title: "先斗町 居酒屋", category: "food", amount: 18600, currency: "JPY", rate: RATE.early, paidBy: ownerUid, split: "all", place: PLACES.pontocho, note: "含 10% 服務費" },
  { date: "2026-04-08", time: "21:00", title: "藥妝店 各買各的", category: "shopping", amount: 8420, currency: "JPY", rate: RATE.early, paidBy: XIAOMEI, split: { [XIAOMEI]: 5000, [ownerUid]: 3420 } },

  // Day 2
  { date: "2026-04-09", time: "08:10", title: "早餐 咖啡", category: "food", amount: 2080, currency: "JPY", rate: RATE.early, paidBy: AJIE, split: "all" },
  { date: "2026-04-09", time: "09:00", title: "地鐵一日券 ×4", category: "transport", amount: 3400, currency: "JPY", rate: RATE.early, paidBy: ownerUid, split: "all" },
  { date: "2026-04-09", time: "10:30", title: "伏見稻荷 御守", category: "shopping", amount: 1500, currency: "JPY", rate: RATE.early, paidBy: XIAOMEI, split: { [XIAOMEI]: 1500 }, place: PLACES.fushimi, note: "自己買的，不用分" },
  { date: "2026-04-09", time: "12:30", title: "稻荷山下 鰻魚飯", category: "food", amount: 9600, currency: "JPY", rate: RATE.early, paidBy: AMEI, split: "all", place: PLACES.fushimi },
  { date: "2026-04-09", time: "14:00", title: "和服租借", category: "other", amount: 16000, currency: "JPY", rate: RATE.early, paidBy: XIAOMEI, split: [XIAOMEI, AJIE], note: "只有小美跟阿傑租" },
  { date: "2026-04-09", time: "15:30", title: "清水寺 門票 ×4", category: "ticket", amount: 1600, currency: "JPY", rate: RATE.early, paidBy: ownerUid, split: "all", place: PLACES.kiyomizu },
  { date: "2026-04-09", time: "16:20", title: "清水坂 抹茶冰淇淋", category: "food", amount: 1840, currency: "JPY", rate: RATE.early, paidBy: AJIE, split: "all", place: PLACES.kiyomizu },
  { date: "2026-04-09", time: "19:00", title: "祇園 晚餐", category: "food", amount: 24800, currency: "JPY", rate: RATE.early, paidBy: AMEI, split: "all", place: PLACES.gion },
  // 沒記時間的一筆：時間軸要把它排在當天最後，不能塞中間。
  { date: "2026-04-09", time: "", title: "自助洗衣", category: "other", amount: 800, currency: "JPY", rate: RATE.early, paidBy: ownerUid, split: "all" },

  // Day 3
  { date: "2026-04-10", time: "08:30", title: "飯店附近 早餐", category: "food", amount: 2400, currency: "JPY", rate: RATE.mid, paidBy: XIAOMEI, split: "all" },
  { date: "2026-04-10", time: "09:15", title: "嵐電 車票", category: "transport", amount: 1600, currency: "JPY", rate: RATE.mid, paidBy: ownerUid, split: "all" },
  { date: "2026-04-10", time: "10:00", title: "天龍寺 門票 ×4", category: "ticket", amount: 3200, currency: "JPY", rate: RATE.mid, paidBy: AJIE, split: "all", place: PLACES.tenryuji },
  { date: "2026-04-10", time: "11:30", title: "嵐山 租腳踏車", category: "other", amount: 4000, currency: "JPY", rate: RATE.mid, paidBy: AMEI, split: "all", place: PLACES.bamboo },
  { date: "2026-04-10", time: "12:40", title: "湯豆腐 午餐", category: "food", amount: 13200, currency: "JPY", rate: RATE.mid, paidBy: ownerUid, split: "all", place: PLACES.bamboo },
  { date: "2026-04-10", time: "14:30", title: "渡月橋 伴手禮", category: "shopping", amount: 5600, currency: "JPY", rate: RATE.mid, paidBy: XIAOMEI, split: "all", place: PLACES.togetsukyo },
  { date: "2026-04-10", time: "16:00", title: "河邊咖啡", category: "food", amount: 2240, currency: "JPY", rate: RATE.mid, paidBy: AJIE, split: "all", place: PLACES.togetsukyo },
  { date: "2026-04-10", time: "19:30", title: "燒肉", category: "food", amount: 32000, currency: "JPY", rate: RATE.mid, paidBy: AMEI, split: "all", note: "慶祝阿傑生日" },
  { date: "2026-04-10", time: "21:30", title: "便利商店 宵夜", category: "food", amount: 1240, currency: "JPY", rate: RATE.mid, paidBy: ownerUid, split: "all" },

  // Day 4
  { date: "2026-04-11", time: "07:50", title: "早餐", category: "food", amount: 2600, currency: "JPY", rate: RATE.mid, paidBy: AJIE, split: "all" },
  { date: "2026-04-11", time: "08:40", title: "JR 京都→大阪", category: "transport", amount: 2320, currency: "JPY", rate: RATE.mid, paidBy: ownerUid, split: "all", place: PLACES.kyotoStation },
  { date: "2026-04-11", time: "10:00", title: "環球影城 門票 ×4", category: "ticket", amount: 34800, currency: "JPY", rate: RATE.mid, paidBy: AMEI, split: "all", place: PLACES.usj },
  { date: "2026-04-11", time: "12:30", title: "園區內 午餐", category: "food", amount: 7800, currency: "JPY", rate: RATE.mid, paidBy: XIAOMEI, split: "all", place: PLACES.usj },
  { date: "2026-04-11", time: "15:00", title: "園區 周邊商品", category: "shopping", amount: 12400, currency: "JPY", rate: RATE.mid, paidBy: XIAOMEI, split: { [XIAOMEI]: 6400, [AJIE]: 6000 }, place: PLACES.usj },
  { date: "2026-04-11", time: "18:30", title: "道頓堀 章魚燒", category: "food", amount: 2400, currency: "JPY", rate: RATE.mid, paidBy: AJIE, split: "all", place: PLACES.dotonbori },
  { date: "2026-04-11", time: "19:30", title: "心齋橋 藥妝掃貨", category: "shopping", amount: 26800, currency: "JPY", rate: RATE.mid, paidBy: ownerUid, split: { [ownerUid]: 8000, [AMEI]: 6800, [XIAOMEI]: 7000, [AJIE]: 5000 }, place: PLACES.shinsaibashi, note: "各自算各自的，我先刷卡" },
  { date: "2026-04-11", time: "21:00", title: "大阪 晚餐", category: "food", amount: 19600, currency: "JPY", rate: RATE.mid, paidBy: AMEI, split: "all", place: PLACES.dotonbori },
  { date: "2026-04-11", time: "22:30", title: "計程車 回飯店", category: "transport", amount: 3600, currency: "JPY", rate: RATE.mid, paidBy: XIAOMEI, split: "all" },

  // Day 5
  { date: "2026-04-12", time: "08:00", title: "飯店早餐", category: "food", amount: 4800, currency: "JPY", rate: RATE.late, paidBy: ownerUid, split: "all", place: PLACES.hotel },
  { date: "2026-04-12", time: "09:30", title: "錦市場 伴手禮", category: "shopping", amount: 14200, currency: "JPY", rate: RATE.late, paidBy: AMEI, split: { [AMEI]: 4200, [ownerUid]: 4000, [XIAOMEI]: 3000, [AJIE]: 3000 }, place: PLACES.nishiki },
  { date: "2026-04-12", time: "11:00", title: "咖啡", category: "food", amount: 2080, currency: "JPY", rate: RATE.late, paidBy: AJIE, split: "all" },
  { date: "2026-04-12", time: "12:20", title: "HARUKA 京都→關西機場", category: "transport", amount: 12400, currency: "JPY", rate: RATE.late, paidBy: ownerUid, split: "all", place: PLACES.kyotoStation },
  { date: "2026-04-12", time: "14:00", title: "機場 拉麵", category: "food", amount: 5600, currency: "JPY", rate: RATE.late, paidBy: XIAOMEI, split: "all", place: PLACES.kix },
  { date: "2026-04-12", time: "15:00", title: "免稅店", category: "shopping", amount: 18600, currency: "JPY", rate: RATE.late, paidBy: AJIE, split: { [AJIE]: 9600, [AMEI]: 5000, [ownerUid]: 4000 }, place: PLACES.kix },
  { date: "2026-04-12", time: "", title: "機場寄物櫃", category: "other", amount: 1200, currency: "JPY", rate: RATE.late, paidBy: ownerUid, split: "all", place: PLACES.kix }
];

/** 回國之後還的錢。pending 那筆刻意留著，結算頁要顯示「還沒算進餘額」。 */
const PAYMENTS = [
  { from: XIAOMEI, to: AMEI, amount: 300000, status: "confirmed", createdBy: XIAOMEI },
  { from: AJIE, to: ownerUid, amount: 200000, status: "pending", createdBy: AJIE }
];

// ---------------------------------------------------------------- 組裝

function buildSplits(spec, amount) {
  if (spec && !Array.isArray(spec) && typeof spec === "object") {
    const total = Object.values(spec).reduce((acc, v) => acc + v, 0);
    if (total !== amount) {
      throw new Error(`自訂分攤合計 ${total} 不等於金額 ${amount}`);
    }
    return { splitMode: "custom", splits: spec };
  }

  const uids = spec === "all" ? ALL : spec;
  const shares = allocate(amount, uids.map(() => 1));
  return {
    splitMode: "even",
    splits: Object.fromEntries(uids.map((uid, i) => [uid, shares[i]]))
  };
}

/**
 * createdAt 用消費當天的時間，不是現在。
 * 支出列表在同一天內是按 createdAt 排序的，全部設成同一個「現在」的話，
 * 一天之內的順序會變成隨機的，時間軸就看不出行程的先後。
 */
function dateFor(date, time, index) {
  const [hh, mm] = (time || "23:59").split(":").map(Number);
  const at = new Date(`${date}T00:00:00+09:00`);
  at.setUTCHours(at.getUTCHours() + hh - 9, mm + (index % 60), 0, 0);
  return at;
}

const inviteCode = Array.from({ length: 16 }, () =>
  Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
).join("");

async function seed() {
  // 動態 import：--dry-run 不該因為沒裝 firebase-admin 就跑不起來。
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

  initializeApp({ cert: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
  const db = getFirestore();

  const taskRef = db.collection("tasks").doc();
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();

  batch.set(taskRef, {
    name: TASK.name,
    ownerId: ownerUid,
    adminIds: [ownerUid, AMEI],
    memberIds: ALL,
    defaultCurrency: TASK.defaultCurrency,
    startDate: TASK.startDate,
    endDate: TASK.endDate,
    status: "active",
    inviteCode,
    memberCount: MEMBERS.length,
    expenseCount: EXPENSES.length,
    createdAt: now,
    updatedAt: now
  });

  batch.set(db.collection("invites").doc(inviteCode), {
    taskId: taskRef.id,
    taskName: TASK.name,
    defaultCurrency: TASK.defaultCurrency,
    startDate: TASK.startDate,
    endDate: TASK.endDate,
    createdBy: ownerUid,
    active: true,
    createdAt: now
  });

  for (const member of MEMBERS) {
    batch.set(taskRef.collection("members").doc(member.uid), {
      uid: member.uid,
      nickname: member.nickname,
      role: member.role,
      joinedAt: now,
      active: true
    });
  }

  EXPENSES.forEach((item, index) => {
    const { splitMode, splits } = buildSplits(item.split, item.amount);
    const baseAmount = convertAmount(item.amount, item.currency, TASK.defaultCurrency, item.rate);
    const at = Timestamp.fromDate(dateFor(item.date, item.time, index));

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

  for (const payment of PAYMENTS) {
    batch.set(taskRef.collection("payments").doc(), {
      from: payment.from,
      to: payment.to,
      amount: payment.amount,
      currency: TASK.defaultCurrency,
      status: payment.status,
      createdBy: payment.createdBy,
      createdAt: now,
      confirmedAt: payment.status === "confirmed" ? now : null,
      updatedAt: now
    });
  }

  await batch.commit();
  return taskRef.id;
}

// ---------------------------------------------------------------- 執行

const jpyTotal = EXPENSES.filter(e => e.currency === "JPY").reduce((a, e) => a + e.amount, 0);
const twdTotal = EXPENSES.reduce(
  (a, e) => a + convertAmount(e.amount, e.currency, "TWD", e.rate),
  0
);

/**
 * 逐筆比對 `firestore.rules` 的 validExpenseShape()。
 *
 * Admin SDK 會繞過 Security Rules，所以不驗的話，寫得進去但 App 改不動的
 * 支出會安靜地產生 —— 而那正是這份資料最沒有價值的失敗方式。
 */
function validate() {
  const problems = [];
  const known = new Set(ALL);

  EXPENSES.forEach((item, index) => {
    const where = `#${index + 1} ${item.date} ${item.title}`;

    if (item.title.length > 60) problems.push(`${where}：標題超過 60 字`);
    if (!Number.isInteger(item.amount) || item.amount <= 0) problems.push(`${where}：金額必須是正整數`);
    if (!(item.rate > 0)) problems.push(`${where}：匯率必須大於 0`);
    if ((item.note ?? "").length > 500) problems.push(`${where}：備註超過 500 字`);
    if (item.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) {
      problems.push(`${where}：時間格式不是 HH:MM`);
    }
    if (!known.has(item.paidBy)) problems.push(`${where}：先付的人不在成員名單裡`);

    const base = convertAmount(item.amount, item.currency, TASK.defaultCurrency, item.rate);
    if (!Number.isInteger(base) || base <= 0) problems.push(`${where}：換算後金額必須是正整數`);

    try {
      const { splits } = buildSplits(item.split, item.amount);
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

const problems = validate();
if (problems.length) {
  console.error(`資料有 ${problems.length} 個問題，沒有寫入任何東西：\n`);
  problems.forEach(p => console.error("  " + p));
  process.exit(1);
}

if (dryRun) {
  const byDate = new Map();
  EXPENSES.forEach(item => {
    const base = convertAmount(item.amount, item.currency, TASK.defaultCurrency, item.rate);
    byDate.set(item.date, (byDate.get(item.date) ?? 0) + base);
  });

  console.log(`\n${TASK.name}　${TASK.startDate} ～ ${TASK.endDate}\n`);
  console.log(`  ${EXPENSES.length} 筆支出全部通過 validExpenseShape() 的檢查\n`);
  for (const [date, total] of [...byDate].sort()) {
    const count = EXPENSES.filter(e => e.date === date).length;
    const label = date < TASK.startDate ? "出發前" : `Day ${Math.round((Date.parse(date) - Date.parse(TASK.startDate)) / 86400000) + 1}`;
    console.log(`  ${date}  ${label.padEnd(7)} ${String(count).padStart(2)} 筆   TWD ${(total / 100).toLocaleString().padStart(9)}`);
  }
  console.log(`\n  總額      TWD ${(twdTotal / 100).toLocaleString()}`);
  console.log(`  每人平均  TWD ${Math.round(twdTotal / 100 / MEMBERS.length).toLocaleString()}`);
  console.log(`  JPY 小計  ¥${jpyTotal.toLocaleString()}`);
  console.log(`  有座標    ${EXPENSES.filter(e => e.place).length} 筆（地圖與報告用）`);
  console.log(`  自訂分攤  ${EXPENSES.filter(e => e.split && !Array.isArray(e.split) && typeof e.split === "object").length} 筆`);
  console.log(`  沒記時間  ${EXPENSES.filter(e => e.time === "").length} 筆（時間軸要排在當天最後）\n`);
  console.log("  這是 --dry-run，沒有寫入任何資料。\n");
  process.exit(0);
}

seed()
  .then(taskId => {
    console.log(`
建立完成

  任務      ${TASK.name}
  taskId    ${taskId}
  成員      ${MEMBERS.map(m => m.nickname).join("、")}
  支出      ${EXPENSES.length} 筆（JPY ${jpyTotal.toLocaleString()} + 事前 TWD）
  總額      TWD ${(twdTotal / 100).toLocaleString()}
  每人平均  TWD ${Math.round(twdTotal / 100 / MEMBERS.length).toLocaleString()}
  付款      ${PAYMENTS.length} 筆（1 已確認、1 待確認）

  開啟      /tasks/${taskId}
  邀請連結  /join/${inviteCode}

要刪掉的話（子集合要一起，Firestore 沒有 cascade delete）：
  npx firebase firestore:delete tasks/${taskId} --recursive --force
  npx firebase firestore:delete invites/${inviteCode} --force
`);
    process.exit(0);
  })
  .catch(err => {
    console.error("建立失敗：", err.message);
    process.exit(1);
  });
