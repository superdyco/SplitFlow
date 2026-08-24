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
import { parseSeedArgs, runSeed } from "./seed-lib.mjs";

/**
 * --dry-run 完全不碰 Firebase：驗算每一筆的分攤與換算後把結果印出來。
 * 組裝、驗證、寫入的機制都在 seed-lib.mjs，這個檔案只剩這趟旅程的資料。
 */
const args = parseSeedArgs("seed-trip.mjs");
const { ownerUid, ownerNickname } = args;


// ---------------------------------------------------------------- 金額工具

const MINOR_UNITS = { TWD: 2, JPY: 0 };

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

// ---------------------------------------------------------------- 執行

await runSeed({
  args,
  task: TASK,
  members: MEMBERS,
  expenses: EXPENSES,
  payments: PAYMENTS,
  minorUnits: MINOR_UNITS,
  // 日本是 UTC+9：createdAt 要落在消費當天的當地時間
  utcOffsetHours: 9
});
