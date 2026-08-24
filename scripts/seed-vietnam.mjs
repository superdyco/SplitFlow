/**
 * 建立一筆大型示範任務：河內・下龍灣・寧平 六天五夜，100 筆支出、15 位成員、8 筆付款。
 *
 * 這是壓力測試用的種子資料。京都那份（42 筆、4 人）驗的是「功能對不對」，
 * 這份驗的是「量大了會不會垮」：
 *
 *   - 15 人均分的餘數分配 —— 350,000 VND / 15 這種除不盡的，餘數要落在該落的人身上
 *   - 任務頁一次載 100 筆的渲染時間（效能量測的 render 分段直接看得到）
 *   - 「計算我的花費」要抓 100 筆支出 + 15 個成員在前端算
 *   - 結算的最少轉帳次數演算法在 15 人的圖上跑
 *   - VND 是 0 位小數的幣別（跟 JPY 同組），金額又大（百萬等級），
 *     報告的圖表刻度與金額排版要撐得住七位數
 *
 * 機制（組裝、驗證、寫入、dry-run）都在 seed-lib.mjs，這個檔案只有資料。
 *
 * 用法：
 *   node scripts/seed-vietnam.mjs --key <service-account.json> --uid <你的 uid> [--nickname 我]
 *
 * 先看資料（不需要金鑰、不寫入）：
 *   node scripts/seed-vietnam.mjs --dry-run
 *
 * 刪除（子集合要分開刪，Firestore 沒有 cascade delete）：
 *   npx firebase firestore:delete tasks/<taskId> --recursive --force
 */
import { parseSeedArgs, runSeed } from "./seed-lib.mjs";

const args = parseSeedArgs("seed-vietnam.mjs");
const { ownerUid, ownerNickname } = args;

/** VND 跟 KRW 一樣是 0 位小數 —— 跟 src/utils/currency.ts 的表對齊。 */
const MINOR_UNITS = { TWD: 2, VND: 0, USD: 2 };

// ---------------------------------------------------------------- 成員

/**
 * uid 一律 `seed-vn-` 開頭：查不到的假帳號，清資料時一眼認得出來，
 * 也跟京都那份的 `seed-` 系列不撞名。只有 owner 是真的 uid。
 */
const MING = "seed-vn-ming";
const MEI = "seed-vn-mei";
const JIE = "seed-vn-jie";
const TING = "seed-vn-yating";
const HAO = "seed-vn-zhihao";
const JUN = "seed-vn-yijun";
const JIA = "seed-vn-jiahao";
const FEN = "seed-vn-shufen";
const HONG = "seed-vn-junhong";
const SHAN = "seed-vn-peishan";
const YU = "seed-vn-guanyu";
const XIN = "seed-vn-xinyi";
const XIONG = "seed-vn-daxiong";
const YUN = "seed-vn-xiaoyun";

/** 15 人團要兩個 admin 才管得動 —— 這也順便測「多個 admin」的權限顯示。 */
const MEMBERS = [
  { uid: ownerUid, nickname: ownerNickname, role: "owner" },
  { uid: MING, nickname: "阿明", role: "admin" },
  { uid: MEI, nickname: "小美", role: "admin" },
  { uid: JIE, nickname: "阿傑", role: "member" },
  { uid: TING, nickname: "雅婷", role: "member" },
  { uid: HAO, nickname: "志豪", role: "member" },
  { uid: JUN, nickname: "怡君", role: "member" },
  { uid: JIA, nickname: "家豪", role: "member" },
  { uid: FEN, nickname: "淑芬", role: "member" },
  { uid: HONG, nickname: "俊宏", role: "member" },
  { uid: SHAN, nickname: "佩珊", role: "member" },
  { uid: YU, nickname: "冠宇", role: "member" },
  { uid: XIN, nickname: "心怡", role: "member" },
  { uid: XIONG, nickname: "大雄", role: "member" },
  { uid: YUN, nickname: "小芸", role: "member" }
];

const TASK = {
  name: "河內・下龍灣・寧平 六天五夜",
  defaultCurrency: "TWD",
  startDate: "2026-06-15",
  endDate: "2026-06-20"
};

/**
 * 15 人不會永遠整團行動 —— 小團體是這份資料刻意要多的東西，
 * 均分名單五花八門才測得出「餘數分給誰」在各種人數下都對。
 */
const NIGHT10 = [ownerUid, MING, JIE, HAO, JIA, HONG, YU, XIONG, MEI, TING];
const SPA6 = [MEI, TING, JUN, FEN, SHAN, XIN];
const SPA8 = [MEI, TING, JUN, FEN, SHAN, XIN, YUN, JIA];
const KAYAK6 = [ownerUid, HAO, JIA, YU, XIONG, JIE];
const CLIMB12 = [ownerUid, MING, MEI, JIE, TING, HAO, JUN, JIA, HONG, YU, XIN, XIONG];
const BANHMI8 = [XIONG, ownerUid, JIE, HAO, JIA, YU, HONG, MING];
const SKY9 = [YU, ownerUid, MING, MEI, TING, HAO, JIA, JUN, XIN];
const PORRIDGE5 = [ownerUid, JIE, JIA, HAO, XIONG];
const MANGO7 = [XIONG, YUN, XIN, TING, JUN, MEI, SHAN];
const BEER9 = [YU, ownerUid, MING, JIE, HAO, JIA, HONG, XIONG, MEI];
const CHE6 = [XIN, YUN, TING, JUN, FEN, SHAN];
const LOTTE10 = [TING, ownerUid, MEI, MING, JUN, XIN, YUN, FEN, SHAN, HAO];
const TEA8 = [JUN, MEI, TING, FEN, SHAN, XIN, YUN, ownerUid];
const LAUNDRY5 = [SHAN, FEN, TING, MEI, JUN];
const WRAP4 = [XIONG, JIA, HONG, YU];
const GRAB3 = [YU, XIONG, HONG];

// ---------------------------------------------------------------- 地點

/** 真實座標。下龍灣跟寧平離河內夠遠，報告的靜態地圖會被迫拉出大範圍。 */
const PLACES = {
  noibai: { name: "內排國際機場", address: "Phú Minh, Sóc Sơn, Hà Nội", lat: 21.2212, lng: 105.8072 },
  hotel: { name: "老城區飯店", address: "Hàng Bông, Hoàn Kiếm, Hà Nội", lat: 21.03, lng: 105.848 },
  oldquarter: { name: "河內三十六古街", address: "Hàng Đào, Hoàn Kiếm, Hà Nội", lat: 21.0338, lng: 105.85 },
  hoankiem: { name: "還劍湖", address: "Hoàn Kiếm, Hà Nội", lat: 21.0288, lng: 105.8525 },
  puppet: { name: "昇龍水上木偶戲院", address: "57B Đinh Tiên Hoàng, Hà Nội", lat: 21.0304, lng: 105.8531 },
  stjoseph: { name: "河內大教堂", address: "40 Nhà Chung, Hoàn Kiếm, Hà Nội", lat: 21.0287, lng: 105.849 },
  temple: { name: "文廟", address: "58 Quốc Tử Giám, Đống Đa, Hà Nội", lat: 21.0293, lng: 105.8354 },
  mausoleum: { name: "胡志明陵寢", address: "2 Hùng Vương, Ba Đình, Hà Nội", lat: 21.0369, lng: 105.8347 },
  trainstreet: { name: "河內火車街", address: "Trần Phú, Hoàn Kiếm, Hà Nội", lat: 21.0248, lng: 105.8412 },
  dongxuan: { name: "同春市場", address: "Đồng Xuân, Hoàn Kiếm, Hà Nội", lat: 21.0382, lng: 105.8494 },
  tahien: { name: "Tạ Hiện 啤酒街", address: "Tạ Hiện, Hoàn Kiếm, Hà Nội", lat: 21.0345, lng: 105.8517 },
  westlake: { name: "西湖", address: "Tây Hồ, Hà Nội", lat: 21.0587, lng: 105.8229 },
  lotte: { name: "Lotte 觀景台", address: "54 Liễu Giai, Ba Đình, Hà Nội", lat: 21.0321, lng: 105.8127 },
  tuanchau: { name: "巡州島遊船碼頭", address: "Tuần Châu, Hạ Long", lat: 20.9276, lng: 106.9769 },
  halong: { name: "下龍灣", address: "Vịnh Hạ Long, Quảng Ninh", lat: 20.9101, lng: 107.1839 },
  sungsot: { name: "驚訝洞", address: "Đảo Bồ Hòn, Hạ Long", lat: 20.8267, lng: 107.0975 },
  titop: { name: "Ti Tốp 島", address: "Vịnh Hạ Long, Quảng Ninh", lat: 20.8006, lng: 107.0771 },
  hoalu: { name: "華閭古都", address: "Trường Yên, Hoa Lư, Ninh Bình", lat: 20.2864, lng: 105.9057 },
  trangan: { name: "長安生態保護區", address: "Ninh Xuân, Hoa Lư, Ninh Bình", lat: 20.254, lng: 105.913 },
  tamcoc: { name: "三谷", address: "Ninh Hải, Hoa Lư, Ninh Bình", lat: 20.2153, lng: 105.937 },
  muacave: { name: "姥山觀景台", address: "Khê Hạ, Ninh Xuân, Ninh Bình", lat: 20.2264, lng: 105.933 }
};

// ---------------------------------------------------------------- 支出

/**
 * VND 兌 TWD 逐日微調 —— 匯率是記帳當下鎖進支出的，整趟同一個數字
 * 就測不出鎖匯率這件事。USD 只有簽證跟包船兩筆，測第三種幣別的合併。
 */
const VND = { d1: 0.00126, d2: 0.00126, d3: 0.00127, d4: 0.00127, d5: 0.00125, d6: 0.00126 };
const USD = 31.5;

const EXPENSES = [
  // 出發前。機票 15 人一起刷是這份資料最大的一筆 —— 圖表的刻度要撐得住它。
  { date: "2026-04-28", time: "", title: "機票 台北－河內 來回 ×15", category: "transport", amount: 10200000, currency: "TWD", rate: 1, paidBy: ownerUid, split: "all", note: "團體票，一次刷我的卡" },
  { date: "2026-04-28", time: "", title: "住宿訂金 八間房", category: "stay", amount: 3000000, currency: "TWD", rate: 1, paidBy: MING, split: "all" },
  { date: "2026-05-30", time: "", title: "電子簽證 ×15", category: "other", amount: 37500, currency: "USD", rate: USD, paidBy: MEI, split: "all", note: "一人 25 美金" },

  // Day 1（06-15）抵達河內
  { date: "2026-06-15", time: "09:50", title: "機場包車兩台 內排→老城區", category: "transport", amount: 1050000, currency: "VND", rate: VND.d1, paidBy: ownerUid, split: "all", place: PLACES.noibai },
  { date: "2026-06-15", time: "10:40", title: "SIM 卡 ×15", category: "other", amount: 1950000, currency: "VND", rate: VND.d1, paidBy: HAO, split: "all", place: PLACES.noibai },
  { date: "2026-06-15", time: "12:10", title: "行李寄放小費", category: "other", amount: 150000, currency: "VND", rate: VND.d1, paidBy: SHAN, split: "all", place: PLACES.hotel },
  { date: "2026-06-15", time: "12:40", title: "老城區河粉午餐", category: "food", amount: 1275000, currency: "VND", rate: VND.d1, paidBy: MING, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-15", time: "14:00", title: "飯店尾款 八間房五晚", category: "stay", amount: 52500000, currency: "VND", rate: VND.d1, paidBy: MING, split: "all", place: PLACES.hotel, note: "訂金已在出發前付掉" },
  { date: "2026-06-15", time: "15:30", title: "還劍湖 椰子咖啡", category: "food", amount: 975000, currency: "VND", rate: VND.d1, paidBy: TING, split: "all", place: PLACES.hoankiem },
  { date: "2026-06-15", time: "16:00", title: "斗笠跟小物", category: "shopping", amount: 240000, currency: "VND", rate: VND.d1, paidBy: YUN, split: { [YUN]: 150000, [TING]: 90000 }, place: PLACES.oldquarter },
  { date: "2026-06-15", time: "16:30", title: "水上木偶戲 ×15", category: "ticket", amount: 1500000, currency: "VND", rate: VND.d1, paidBy: MEI, split: "all", place: PLACES.puppet },
  { date: "2026-06-15", time: "17:15", title: "路邊 Bánh mì 八份", category: "food", amount: 360000, currency: "VND", rate: VND.d1, paidBy: XIONG, split: BANHMI8, place: PLACES.oldquarter },
  { date: "2026-06-15", time: "18:30", title: "越式家常菜晚餐 兩大桌", category: "food", amount: 3450000, currency: "VND", rate: VND.d1, paidBy: ownerUid, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-15", time: "19:45", title: "Tràng Tiền 冰淇淋", category: "food", amount: 525000, currency: "VND", rate: VND.d1, paidBy: XIN, split: "all", place: PLACES.hoankiem },
  { date: "2026-06-15", time: "20:00", title: "Tạ Hiện 啤酒街", category: "food", amount: 1860000, currency: "VND", rate: VND.d1, paidBy: JIA, split: NIGHT10, place: PLACES.tahien, note: "五個人先回飯店休息" },
  { date: "2026-06-15", time: "21:00", title: "按摩 ×6", category: "other", amount: 2700000, currency: "VND", rate: VND.d1, paidBy: FEN, split: SPA6 },
  { date: "2026-06-15", time: "21:30", title: "便利商店 水跟零食", category: "food", amount: 690000, currency: "VND", rate: VND.d1, paidBy: JUN, split: "all" },
  { date: "2026-06-15", time: "22:00", title: "Grab 三人補位回飯店", category: "transport", amount: 95000, currency: "VND", rate: VND.d1, paidBy: YU, split: GRAB3, note: "95,000 除以 3 除不盡，測餘數" },
  { date: "2026-06-15", time: "", title: "飯店洗衣", category: "other", amount: 300000, currency: "VND", rate: VND.d1, paidBy: HONG, split: "all" },

  // Day 2（06-16）河內市區
  { date: "2026-06-16", time: "07:30", title: "蛋咖啡早餐", category: "food", amount: 1125000, currency: "VND", rate: VND.d2, paidBy: ownerUid, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-16", time: "08:15", title: "鮮榨甘蔗汁 ×15", category: "food", amount: 300000, currency: "VND", rate: VND.d2, paidBy: XIONG, split: "all" },
  { date: "2026-06-16", time: "08:30", title: "包車一日 兩台十六人座", category: "transport", amount: 2600000, currency: "VND", rate: VND.d2, paidBy: MING, split: "all" },
  { date: "2026-06-16", time: "09:00", title: "胡志明陵寢 寄物", category: "ticket", amount: 150000, currency: "VND", rate: VND.d2, paidBy: JIE, split: "all", place: PLACES.mausoleum },
  { date: "2026-06-16", time: "10:30", title: "文廟門票 ×15", category: "ticket", amount: 1050000, currency: "VND", rate: VND.d2, paidBy: MEI, split: "all", place: PLACES.temple },
  { date: "2026-06-16", time: "11:00", title: "文廟 書法字", category: "shopping", amount: 200000, currency: "VND", rate: VND.d2, paidBy: SHAN, split: { [SHAN]: 200000 }, place: PLACES.temple, note: "幫爸爸求的，自己付" },
  { date: "2026-06-16", time: "12:30", title: "Bún chả 午餐", category: "food", amount: 2250000, currency: "VND", rate: VND.d2, paidBy: HAO, split: "all", place: PLACES.oldquarter, note: "歐巴馬套餐那家" },
  { date: "2026-06-16", time: "13:15", title: "寄明信片 郵資", category: "other", amount: 180000, currency: "VND", rate: VND.d2, paidBy: YUN, split: [YUN, TING, XIN] },
  { date: "2026-06-16", time: "14:00", title: "大教堂旁 檸檬茶", category: "food", amount: 675000, currency: "VND", rate: VND.d2, paidBy: JUN, split: "all", place: PLACES.stjoseph },
  { date: "2026-06-16", time: "15:30", title: "火車街咖啡 低消 ×15", category: "food", amount: 1350000, currency: "VND", rate: VND.d2, paidBy: TING, split: "all", place: PLACES.trainstreet, note: "為了看火車貼著桌子過" },
  { date: "2026-06-16", time: "16:20", title: "同春市場 快煮包跟腰果", category: "shopping", amount: 1840000, currency: "VND", rate: VND.d2, paidBy: FEN, split: { [FEN]: 640000, [JUN]: 400000, [XIN]: 400000, [YUN]: 400000 }, place: PLACES.dongxuan },
  { date: "2026-06-16", time: "18:00", title: "烤肉米線晚餐", category: "food", amount: 3150000, currency: "VND", rate: VND.d2, paidBy: JIA, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-16", time: "19:30", title: "天空酒吧 低消 ×9", category: "ticket", amount: 2970000, currency: "VND", rate: VND.d2, paidBy: YU, split: SKY9, note: "其他人去逛夜市" },
  { date: "2026-06-16", time: "19:40", title: "夜市戰利品 混一張單", category: "shopping", amount: 960000, currency: "VND", rate: VND.d2, paidBy: XIN, split: { [XIN]: 360000, [XIONG]: 250000, [YUN]: 350000 }, place: PLACES.dongxuan },
  { date: "2026-06-16", time: "21:30", title: "Grab 分批回飯店", category: "transport", amount: 420000, currency: "VND", rate: VND.d2, paidBy: HONG, split: "all" },
  { date: "2026-06-16", time: "22:15", title: "宵夜 雞肉粥", category: "food", amount: 495000, currency: "VND", rate: VND.d2, paidBy: JIE, split: PORRIDGE5 },
  { date: "2026-06-16", time: "", title: "地陪小費 第一天", category: "other", amount: 750000, currency: "VND", rate: VND.d2, paidBy: ownerUid, split: "all" },

  // Day 3（06-17）下龍灣一日
  { date: "2026-06-17", time: "06:30", title: "巴士 河內⇌下龍灣 兩台", category: "transport", amount: 3900000, currency: "VND", rate: VND.d3, paidBy: ownerUid, split: "all", note: "來回含司機小費" },
  { date: "2026-06-17", time: "07:00", title: "路上早餐 法棍 ×15", category: "food", amount: 525000, currency: "VND", rate: VND.d3, paidBy: MEI, split: "all" },
  { date: "2026-06-17", time: "08:20", title: "暈車藥跟 B 群", category: "food", amount: 255000, currency: "VND", rate: VND.d3, paidBy: HONG, split: "all" },
  { date: "2026-06-17", time: "09:30", title: "包船一日遊 ×15", category: "ticket", amount: 75000, currency: "USD", rate: USD, paidBy: ownerUid, split: "all", place: PLACES.tuanchau, note: "含午餐跟獨木舟，美金計價" },
  { date: "2026-06-17", time: "10:30", title: "下龍灣景區門票 ×15", category: "ticket", amount: 4350000, currency: "VND", rate: VND.d3, paidBy: MING, split: "all", place: PLACES.halong },
  { date: "2026-06-17", time: "11:15", title: "船上明信片", category: "shopping", amount: 90000, currency: "VND", rate: VND.d3, paidBy: YUN, split: { [YUN]: 90000 }, place: PLACES.halong },
  { date: "2026-06-17", time: "12:00", title: "船上加點 現撈斑節蝦", category: "food", amount: 2850000, currency: "VND", rate: VND.d3, paidBy: JIA, split: "all", place: PLACES.halong },
  { date: "2026-06-17", time: "13:30", title: "獨木舟加購 ×6", category: "ticket", amount: 900000, currency: "VND", rate: VND.d3, paidBy: HAO, split: KAYAK6, place: PLACES.sungsot },
  { date: "2026-06-17", time: "14:30", title: "Ti Tốp 島 置物櫃跟淋浴", category: "other", amount: 375000, currency: "VND", rate: VND.d3, paidBy: TING, split: "all", place: PLACES.titop },
  { date: "2026-06-17", time: "15:00", title: "島上椰子水 ×15", category: "food", amount: 675000, currency: "VND", rate: VND.d3, paidBy: JUN, split: "all", place: PLACES.titop },
  { date: "2026-06-17", time: "16:30", title: "船上珍珠項鍊", category: "shopping", amount: 1800000, currency: "VND", rate: VND.d3, paidBy: FEN, split: { [FEN]: 1200000, [SHAN]: 600000 }, place: PLACES.halong, note: "殺過價了" },
  { date: "2026-06-17", time: "17:30", title: "回程休息站 咖啡", category: "food", amount: 720000, currency: "VND", rate: VND.d3, paidBy: XIN, split: "all" },
  { date: "2026-06-17", time: "19:45", title: "回河內 火鍋晚餐", category: "food", amount: 4200000, currency: "VND", rate: VND.d3, paidBy: MING, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-17", time: "21:00", title: "按摩第二輪 ×8", category: "other", amount: 3600000, currency: "VND", rate: VND.d3, paidBy: SHAN, split: SPA8 },
  { date: "2026-06-17", time: "21:30", title: "芒果糯米飯宵夜", category: "food", amount: 390000, currency: "VND", rate: VND.d3, paidBy: XIONG, split: MANGO7, note: "390,000 除以 7 除不盡，測餘數" },
  { date: "2026-06-17", time: "", title: "船員小費", category: "other", amount: 600000, currency: "VND", rate: VND.d3, paidBy: ownerUid, split: "all" },

  // Day 4（06-18）寧平一日
  { date: "2026-06-18", time: "06:45", title: "巴士 河內⇌寧平 兩台", category: "transport", amount: 3300000, currency: "VND", rate: VND.d4, paidBy: MING, split: "all" },
  { date: "2026-06-18", time: "07:00", title: "車上咖啡 ×15", category: "food", amount: 450000, currency: "VND", rate: VND.d4, paidBy: XIONG, split: "all" },
  { date: "2026-06-18", time: "08:30", title: "休息站早餐", category: "food", amount: 900000, currency: "VND", rate: VND.d4, paidBy: JIE, split: "all" },
  { date: "2026-06-18", time: "09:30", title: "華閭古都門票 ×15", category: "ticket", amount: 300000, currency: "VND", rate: VND.d4, paidBy: MEI, split: "all", place: PLACES.hoalu },
  { date: "2026-06-18", time: "10:15", title: "礦泉水補給 一箱", category: "food", amount: 180000, currency: "VND", rate: VND.d4, paidBy: SHAN, split: "all" },
  { date: "2026-06-18", time: "11:00", title: "長安遊船 ×15 五條船", category: "ticket", amount: 3750000, currency: "VND", rate: VND.d4, paidBy: ownerUid, split: "all", place: PLACES.trangan },
  { date: "2026-06-18", time: "12:45", title: "山羊肉午餐", category: "food", amount: 3375000, currency: "VND", rate: VND.d4, paidBy: JIA, split: "all", place: PLACES.tamcoc, note: "寧平名物" },
  { date: "2026-06-18", time: "13:30", title: "船伕小費 五條船", category: "other", amount: 500000, currency: "VND", rate: VND.d4, paidBy: MING, split: "all", place: PLACES.trangan },
  { date: "2026-06-18", time: "14:30", title: "姥山觀景台 ×12", category: "ticket", amount: 1200000, currency: "VND", rate: VND.d4, paidBy: HAO, split: CLIMB12, place: PLACES.muacave, note: "三個人在山下等" },
  { date: "2026-06-18", time: "15:00", title: "山腳下 冰椰子", category: "food", amount: 540000, currency: "VND", rate: VND.d4, paidBy: TING, split: "all", place: PLACES.muacave },
  { date: "2026-06-18", time: "16:30", title: "手工刺繡", category: "shopping", amount: 780000, currency: "VND", rate: VND.d4, paidBy: JUN, split: { [JUN]: 480000, [MEI]: 300000 }, place: PLACES.tamcoc },
  { date: "2026-06-18", time: "18:00", title: "回程過路費跟停車", category: "transport", amount: 250000, currency: "VND", rate: VND.d4, paidBy: ownerUid, split: "all", note: "250,000 除以 15 除不盡，測餘數" },
  { date: "2026-06-18", time: "19:30", title: "回河內 BBQ 晚餐", category: "food", amount: 3900000, currency: "VND", rate: VND.d4, paidBy: HONG, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-18", time: "21:00", title: "啤酒街第二攤", category: "food", amount: 1440000, currency: "VND", rate: VND.d4, paidBy: YU, split: BEER9, place: PLACES.tahien },
  { date: "2026-06-18", time: "21:15", title: "甜湯 chè", category: "food", amount: 360000, currency: "VND", rate: VND.d4, paidBy: XIN, split: CHE6 },
  { date: "2026-06-18", time: "22:30", title: "Grab 回飯店 分三台", category: "transport", amount: 315000, currency: "VND", rate: VND.d4, paidBy: FEN, split: "all" },
  { date: "2026-06-18", time: "", title: "竹編包", category: "shopping", amount: 320000, currency: "VND", rate: VND.d4, paidBy: YUN, split: { [YUN]: 320000 }, place: PLACES.tamcoc },

  // Day 5（06-19）河內自由活動
  { date: "2026-06-19", time: "08:00", title: "飯店早餐加購 ×15", category: "food", amount: 1875000, currency: "VND", rate: VND.d5, paidBy: ownerUid, split: "all", place: PLACES.hotel },
  { date: "2026-06-19", time: "09:00", title: "寄放大件行李", category: "other", amount: 300000, currency: "VND", rate: VND.d5, paidBy: YU, split: "all", place: PLACES.hotel },
  { date: "2026-06-19", time: "09:30", title: "三輪車遊老城 ×15", category: "transport", amount: 2250000, currency: "VND", rate: VND.d5, paidBy: MEI, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-19", time: "10:30", title: "河內咖啡豆 三公斤", category: "shopping", amount: 1530000, currency: "VND", rate: VND.d5, paidBy: MING, split: { [MING]: 510000, [ownerUid]: 510000, [HAO]: 510000 }, place: PLACES.oldquarter },
  { date: "2026-06-19", time: "11:00", title: "Lotte 觀景台 ×10", category: "ticket", amount: 2300000, currency: "VND", rate: VND.d5, paidBy: TING, split: LOTTE10, place: PLACES.lotte },
  { date: "2026-06-19", time: "12:30", title: "西湖邊 海鮮粥", category: "food", amount: 1800000, currency: "VND", rate: VND.d5, paidBy: JIA, split: "all", place: PLACES.westlake },
  { date: "2026-06-19", time: "13:00", title: "路邊甘蔗汁跟春捲", category: "food", amount: 495000, currency: "VND", rate: VND.d5, paidBy: YUN, split: "all" },
  { date: "2026-06-19", time: "14:00", title: "蓮花茶體驗 ×8", category: "food", amount: 1600000, currency: "VND", rate: VND.d5, paidBy: JUN, split: TEA8, place: PLACES.westlake },
  { date: "2026-06-19", time: "15:00", title: "越南國服訂做 ×3", category: "shopping", amount: 2850000, currency: "VND", rate: VND.d5, paidBy: FEN, split: { [FEN]: 950000, [SHAN]: 950000, [XIN]: 950000 }, place: PLACES.oldquarter, note: "隔天早上取件" },
  { date: "2026-06-19", time: "15:45", title: "綠豆糕試吃買一堆", category: "food", amount: 375000, currency: "VND", rate: VND.d5, paidBy: XIN, split: "all" },
  { date: "2026-06-19", time: "16:00", title: "蛋咖啡第二回", category: "food", amount: 825000, currency: "VND", rate: VND.d5, paidBy: HONG, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-19", time: "17:30", title: "同春市場 最後採買", category: "shopping", amount: 2140000, currency: "VND", rate: VND.d5, paidBy: XIONG, split: { [XIONG]: 540000, [YU]: 600000, [JIE]: 500000, [YUN]: 500000 }, place: PLACES.dongxuan },
  { date: "2026-06-19", time: "19:00", title: "告別晚宴 越法餐廳", category: "food", amount: 6750000, currency: "VND", rate: VND.d5, paidBy: ownerUid, split: "all", place: PLACES.hoankiem, note: "整趟最貴的一餐" },
  { date: "2026-06-19", time: "20:45", title: "冰箱貼磁鐵", category: "shopping", amount: 225000, currency: "VND", rate: VND.d5, paidBy: TING, split: { [TING]: 75000, [XIN]: 75000, [YUN]: 75000 } },
  { date: "2026-06-19", time: "21:00", title: "啤酒街告別場 全員", category: "food", amount: 2250000, currency: "VND", rate: VND.d5, paidBy: JIE, split: "all", place: PLACES.tahien },
  { date: "2026-06-19", time: "22:30", title: "Grab 分批回飯店", category: "transport", amount: 465000, currency: "VND", rate: VND.d5, paidBy: HAO, split: "all" },
  { date: "2026-06-19", time: "", title: "飯店洗衣第二次", category: "other", amount: 420000, currency: "VND", rate: VND.d5, paidBy: SHAN, split: LAUNDRY5 },

  // Day 6（06-20）回程
  { date: "2026-06-20", time: "07:30", title: "退房前 河粉早餐", category: "food", amount: 1125000, currency: "VND", rate: VND.d6, paidBy: MING, split: "all", place: PLACES.oldquarter },
  { date: "2026-06-20", time: "08:30", title: "便利商店 車上零食", category: "food", amount: 435000, currency: "VND", rate: VND.d6, paidBy: YUN, split: "all" },
  { date: "2026-06-20", time: "09:00", title: "房間打掃小費 八間", category: "other", amount: 400000, currency: "VND", rate: VND.d6, paidBy: ownerUid, split: "all", place: PLACES.hotel },
  { date: "2026-06-20", time: "09:40", title: "超重行李打包膜 ×4", category: "other", amount: 240000, currency: "VND", rate: VND.d6, paidBy: XIONG, split: WRAP4, place: PLACES.noibai },
  { date: "2026-06-20", time: "10:00", title: "國服取件 補差額", category: "shopping", amount: 300000, currency: "VND", rate: VND.d6, paidBy: FEN, split: { [FEN]: 100000, [SHAN]: 100000, [XIN]: 100000 }, place: PLACES.oldquarter },
  { date: "2026-06-20", time: "10:30", title: "機場巴士兩台", category: "transport", amount: 1050000, currency: "VND", rate: VND.d6, paidBy: MEI, split: "all", place: PLACES.hotel },
  { date: "2026-06-20", time: "11:00", title: "機場推車小費", category: "other", amount: 120000, currency: "VND", rate: VND.d6, paidBy: YU, split: "all", place: PLACES.noibai },
  { date: "2026-06-20", time: "11:45", title: "機場外 最後一碗河粉", category: "food", amount: 975000, currency: "VND", rate: VND.d6, paidBy: JIE, split: "all", place: PLACES.noibai },
  { date: "2026-06-20", time: "12:15", title: "水果乾試吃場", category: "food", amount: 690000, currency: "VND", rate: VND.d6, paidBy: XIN, split: "all", place: PLACES.noibai },
  { date: "2026-06-20", time: "12:30", title: "機場伴手禮 腰果跟咖啡", category: "shopping", amount: 1960000, currency: "VND", rate: VND.d6, paidBy: HAO, split: { [HAO]: 560000, [JIA]: 500000, [HONG]: 450000, [ownerUid]: 450000 }, place: PLACES.noibai },
  { date: "2026-06-20", time: "13:00", title: "登機口咖啡", category: "food", amount: 630000, currency: "VND", rate: VND.d6, paidBy: JUN, split: "all", place: PLACES.noibai },
  { date: "2026-06-20", time: "13:30", title: "免稅店香水", category: "shopping", amount: 1890000, currency: "VND", rate: VND.d6, paidBy: SHAN, split: { [SHAN]: 990000, [TING]: 900000 }, place: PLACES.noibai },
  { date: "2026-06-20", time: "13:45", title: "登機前 河粉泡麵 ×15", category: "food", amount: 495000, currency: "VND", rate: VND.d6, paidBy: JIA, split: "all", place: PLACES.noibai },
  { date: "2026-06-20", time: "", title: "剩的越南盾換回台幣 手續費", category: "other", amount: 450000, currency: "VND", rate: VND.d6, paidBy: ownerUid, split: "all", place: PLACES.noibai }
];

/**
 * 回國後的還款。八筆、混 confirmed 跟 pending —— 15 人的結算頁要顯示
 * 「已折抵」與「還沒算進餘額」並存的狀態，付款清單也要撐得住這個長度。
 */
const PAYMENTS = [
  { from: FEN, to: ownerUid, amount: 500000, status: "confirmed", createdBy: FEN },
  { from: JIE, to: MING, amount: 300000, status: "confirmed", createdBy: JIE },
  { from: TING, to: ownerUid, amount: 450000, status: "confirmed", createdBy: TING },
  { from: YUN, to: MEI, amount: 150000, status: "confirmed", createdBy: YUN },
  { from: XIN, to: MING, amount: 200000, status: "confirmed", createdBy: XIN },
  { from: HAO, to: MING, amount: 280000, status: "pending", createdBy: HAO },
  { from: XIONG, to: ownerUid, amount: 320000, status: "pending", createdBy: XIONG },
  { from: YU, to: ownerUid, amount: 260000, status: "pending", createdBy: YU }
];

// ---------------------------------------------------------------- 執行

await runSeed({
  args,
  task: TASK,
  members: MEMBERS,
  expenses: EXPENSES,
  payments: PAYMENTS,
  minorUnits: MINOR_UNITS,
  // 越南是 UTC+7：createdAt 要落在消費當天的當地時間
  utcOffsetHours: 7
});
