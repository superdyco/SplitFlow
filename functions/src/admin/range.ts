/**
 * 儀表板的時間區間 → 一串日期鍵（`YYYY-MM-DD`）。
 *
 * 每日彙總一天寫一份 `stats/daily/days/{YYYY-MM-DD}`，所以「近 30 天」對後端
 * 來說就是「這 30 個鍵」。把它算成純函式是因為這裡有三個很容易錯、而且錯了
 * 不會噴錯只會默默少一天的地方：時區、月底、以及「最新的一天是哪一天」。
 *
 * ## 為什麼最新的一天是昨天，不是今天
 *
 * 排程在每天 04:00 跑，算的是**前一天的完整資料**。今天的資料要到明天凌晨
 * 才存在。如果把今天也算進區間，儀表板每天早上都會有一個空洞，而折線圖會
 * 把那個洞畫成「掉到 0」—— 那是最糟的一種錯：它看起來像一個發現。
 *
 * ## 為什麼自己算日期不用套件
 *
 * 需要的只有「以台北時間看今天是幾號」跟「往前推 n 天」。前者 `Intl` 就有，
 * 後者是純粹的日曆加減。為這兩件事拉一個日期套件進 functions 的相依，
 * 部署包會變大，而冷啟動時間是這個專案已經在追的東西。
 */

/** 使用者在台灣。彙總的排程也用同一個時區，兩邊必須一致。 */
export const TIME_ZONE = "Asia/Taipei";

export type Range = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90
};

/**
 * `en-CA` 的日期格式剛好就是 `YYYY-MM-DD`。這不是巧合也不是偷懶 ——
 * 它是 ISO 8601 在 CLDR 裡的正式對應，比自己拼字串少一個補零的機會。
 */
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** 某個瞬間，在台北是哪一天。 */
export function dayKeyOf(instant: Date): string {
  return dayFormatter.format(instant);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 日期鍵往前後推 n 天。
 *
 * 用 `Date.UTC` 當載體：這裡處理的是**日曆日期**不是時間點，用 UTC 中立地
 * 做加減就不會被時區或日光節約時間影響（台北沒有日光節約，但這支函式不該
 * 依賴那件事才正確）。
 */
export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** 有彙總資料的最新一天：以台北時間算的昨天。 */
export function latestCompletedDay(now: Date): string {
  return shiftDay(dayKeyOf(now), -1);
}

/**
 * 區間內的日期鍵，**由舊到新**。
 *
 * 由舊到新是給折線圖用的順序 —— 讓呼叫端再排一次序，就是多一個排錯的機會。
 */
export function dayKeys(range: Range, now: Date): string[] {
  const end = latestCompletedDay(now);
  const count = RANGE_DAYS[range];
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftDay(end, -i));
  return keys;
}

/**
 * 驗 callable 送進來的 range。
 *
 * 不預設成 `"30d"`：送進來一個不認得的值代表前端有 bug，默默當成 30 天會讓
 * 那個 bug 永遠不被發現，而使用者看到的是一份「不是他選的區間」的報表。
 */
export function parseRange(value: unknown): Range | null {
  return value === "7d" || value === "30d" || value === "90d" ? value : null;
}

/**
 * 台北時區某一天的起訖瞬間，`[start, end)`。
 *
 * 排程要問 Firestore「createdAt 落在這一天」，而 Firestore 只認 UTC 的瞬間。
 * 台北的 2026-09-05 是 UTC 的 09-04 16:00 到 09-05 16:00 —— 直接拿
 * `new Date("2026-09-05")` 當起點的話，會少算台北時間 00:00–08:00 那八小時，
 * 而且少算的方向永遠一樣，看起來就只是「每天都比預期少一點」。
 *
 * 偏移量是量出來的不是寫死的。台北自 1980 年就沒有日光節約時間，寫死
 * `+8` 現在會對 —— 但這支函式沒有理由依賴一個它自己檢查不了的前提。
 */
export function dayBounds(key: string): { start: Date; end: Date } {
  return { start: localMidnight(key), end: localMidnight(shiftDay(key, 1)) };
}

/** 這個日曆日在台北的午夜，換算成 UTC 的瞬間。 */
function localMidnight(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - offsetAt(new Date(guess)));
}

/**
 * 某個瞬間，台北比 UTC 快幾毫秒。
 *
 * 做法是把同一個瞬間格式化成台北的年月日時分秒，再把那串數字當成 UTC 讀
 * 回來 —— 兩者的差就是偏移量。
 */
function offsetAt(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  // hour12: false 在某些執行環境會把午夜印成 24。
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}
