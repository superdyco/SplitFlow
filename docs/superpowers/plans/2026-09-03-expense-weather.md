# 支出天氣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 從 Google Places 選出來的地點加上支出的日期時間，查出當時的天氣並記在支出上，讓旅費報告的時間軸能說出「那天下大雨」。

**Architecture:** Open-Meteo 的呼叫**只寫在 `functions/` 一份**：純函式放 `weather.ts`，一個 callable 給表單即時預覽、一個獨立觸發器補寫離線記的帳。前端完全不碰 Open-Meteo，只呼叫自己的後端。由下而上：純函式 → 雲端函式 → 規則 → 前端型別與元件 → 四個顯示位置。

**Tech Stack:** Firebase Cloud Functions v2（Node 22、ESM、TypeScript）、vitest（`functions/` 與 `src/` 各有一套）、Vue 3 + TypeScript + Vite、Firestore rules。

**Spec:** `docs/superpowers/specs/2026-09-03-expense-weather-design.md`

## Global Constraints

- **不改任何金額計算、結算、分攤。** 純新增欄位與顯示。
- **不動 `functions/src/message.ts`。** 推播不掛天氣。
- **不動 `flutter_app/`。** callable 是共用的，手機版之後接同一個。
- **不回填舊支出。** 舊的就是沒有天氣。
- **不放寬 `validExpenseShape()` 既有的任何一條。** 只加一個獨立的 `validWeather()`。
- **天氣缺席是正常狀態，不是錯誤。** 三種情況都直接不顯示、不出現錯誤訊息、**絕不擋存檔**：地點沒有座標、API 掛掉或逾時、離線記的帳等觸發器補。
- **攝氏、整數、不做華氏。**
- **`functions/` 是 ESM**（`"type": "module"`），相對 import 一律帶 `.js` 副檔名 —— 例如 `import { x } from "./weather.js"`，即使原始檔是 `.ts`。漏掉的話部署時才會炸。
- **`functions/` 的測試跟被測檔案並排**（`src/weather.test.ts`），不是另開 `tests/`。vitest 設定已經指定 `include: ["src/**/*.test.ts"]`。
- **中文註解，寫「為什麼」不寫「做了什麼」。** 跟著既有風格。
- **這個 repo 的工作區檔案是 CRLF 行尾。** 用腳本做字串比對取代時，樣板字串的換行對不上檔案裡的換行，比對會**靜默失敗**。先偵測行尾再組樣板，或直接用編輯工具。

### 基線

```
cd functions && npm test     # 現有測試全綠
npm run check                # 專案根目錄：vue-tsc --noEmit + vitest
npm run build                # vite build
```

### 已驗證的 API 事實（規格 §3，不要重新猜）

| endpoint | 涵蓋範圍 |
|---|---|
| `https://archive-api.open-meteo.com/v1/archive` | 1940-01-01 到**今天**（含今天，有真值） |
| `https://api.open-meteo.com/v1/forecast` | 往回 93 天、往前 15 天 |

**分流：日期是今天或未來用 forecast，過去用 archive。**

參數名是 snake_case。真實回應：

```json
{
  "timezone": "Asia/Bangkok",
  "daily":  { "time": ["2026-08-20"], "weather_code": [95],
              "temperature_2m_max": [29.6], "temperature_2m_min": [25.0] },
  "hourly": { "time": ["2026-08-20T00:00", "2026-08-20T01:00"],
              "temperature_2m": [26.1, 26.4], "weather_code": [3, 3] }
}
```

錯誤是 HTTP 400 加 `{"error": true, "reason": "..."}`。

---

## File Structure

**新增**

| 檔案 | 責任 |
|---|---|
| `functions/src/weather.ts` | endpoint 選擇、URL 組裝、回應解析。純函式，不碰網路 |
| `functions/src/weather.test.ts` | 上面那些的測試 |
| `src/types/weather.ts` | `ExpenseWeather` 型別與 WMO → 圖示分組 |
| `src/types/weather.test.ts` | 分組的測試 |
| `src/services/weatherService.ts` | 呼叫 `lookupWeather` callable。前端唯一碰天氣後端的地方 |
| `src/components/expense/WeatherChip.vue` | 圖示＋溫度。四個位置共用 |

**修改**

| 檔案 | 變更 |
|---|---|
| `functions/src/index.ts` | 加 `lookupWeather`（onCall）與 `onExpenseWeather`（onDocumentCreated） |
| `firestore.rules` | 加 `validWeather()`，掛進 `validExpenseShape()` |
| `src/types/expense.ts` | `Expense` 加選填 `weather` |
| `src/pages/ExpenseFormPage.vue` | 地點與日期都有了就取預覽；存檔帶上 |
| `src/components/expense/ExpenseRow.vue` | 天氣掛在地點那一行 |
| `src/pages/ExpenseDetailPage.vue` | 地點區加天氣 |
| `src/utils/reportTimeline.ts` | `ReportDay` 加 weather 與挑選規則 |
| `src/utils/reportTimeline.test.ts` | 挑選規則的測試（檔案已存在就加 group） |
| `src/pages/ReportPage.vue` | 時間軸的日表頭顯示天氣 |

**不動**：`functions/src/message.ts`、任何金額或結算相關的檔案、`flutter_app/`。

---

## Task 1: `functions/src/weather.ts` 純函式

**Files:**
- Create: `functions/src/weather.ts`
- Create: `functions/src/weather.test.ts`

**Interfaces:**
- Produces：`WeatherResult`、`weatherUrl(input)`、`readWeather(json, time)`。Task 2 用。

- [ ] **Step 1: 寫會失敗的測試**

建立 `functions/src/weather.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { readWeather, weatherUrl } from "./weather.js";

/**
 * 真實回應的片段。**這是實際打過 API 抄回來的**（2026-08-20，曼谷），
 * 不是照文件寫的 —— 參數名一度被記成 `weathercode`，實際上是 `weather_code`。
 */
const RESPONSE = {
  timezone: "Asia/Bangkok",
  daily: {
    time: ["2026-08-20"],
    weather_code: [95],
    temperature_2m_max: [29.6],
    temperature_2m_min: [25.0]
  },
  hourly: {
    time: ["2026-08-20T18:00", "2026-08-20T19:00", "2026-08-20T20:00"],
    temperature_2m: [25.5, 26.5, 26.3],
    weather_code: [81, 53, 3]
  }
};

describe("weatherUrl", () => {
  const at = { lat: 13.75, lng: 100.5, date: "2026-08-20" };

  it("過去的日期走 archive —— 它涵蓋 1940 年到今天，沒有邊界要煩惱", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("archive-api.open-meteo.com");
  });

  it("今天走 forecast —— archive 只給到目前為止，早上記帳會拿到不完整的高溫", () => {
    const url = weatherUrl({ ...at, date: "2026-09-03", today: "2026-09-03" });
    expect(url).toContain("api.open-meteo.com/v1/forecast");
  });

  it("未來走 forecast —— archive 直接回 400", () => {
    const url = weatherUrl({ ...at, date: "2026-09-10", today: "2026-09-03" });
    expect(url).toContain("api.open-meteo.com/v1/forecast");
  });

  it("一定要帶 timezone=auto", () => {
    // 不帶的話回的是 UTC，曼谷的 19:05 會對到當地凌晨兩點的溫度，
    // 而畫面上完全看不出來。
    expect(weatherUrl({ ...at, today: "2026-09-03" })).toContain("timezone=auto");
  });

  it("日期同時當成起訖，只查那一天", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("start_date=2026-08-20");
    expect(url).toContain("end_date=2026-08-20");
  });

  it("同時要 daily 與 hourly —— 有沒有填時間是呼叫端之後才決定的", () => {
    const url = weatherUrl({ ...at, today: "2026-09-03" });
    expect(url).toContain("daily=");
    expect(url).toContain("hourly=");
  });
});

describe("readWeather", () => {
  it("沒有時間就只給當日高低，exact 是 null", () => {
    expect(readWeather(RESPONSE, "")).toEqual({
      code: 95,
      high: 30,
      low: 25,
      exact: null
    });
  });

  it("有時間就取那個小時的實測值", () => {
    const result = readWeather(RESPONSE, "19:05");
    expect(result?.exact).toBe(27); // 26.5 四捨五入
  });

  it("code 仍然用當日的，不用那小時的", () => {
    // 19:00 那小時是 53（毛毛雨），但那天有雷雨（95）。
    // 圖示要講「那天是什麼樣子」，不是「那一刻剛好在下什麼」。
    expect(readWeather(RESPONSE, "19:05")?.code).toBe(95);
  });

  it("時間對不到任何一個小時就退回沒有 exact，不是丟例外", () => {
    expect(readWeather(RESPONSE, "03:00")?.exact).toBeNull();
  });

  it("錯誤回應回 null —— 不丟例外，缺席是正常狀態", () => {
    expect(readWeather({ error: true, reason: "out of range" }, "")).toBeNull();
  });

  it("欄位缺漏也回 null", () => {
    expect(readWeather({ daily: { time: [] } }, "")).toBeNull();
    expect(readWeather({}, "")).toBeNull();
    expect(readWeather(null, "")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認會失敗**

```bash
cd functions
npm test -- weather
```

Expected: 失敗，訊息是找不到 `./weather.js`。

- [ ] **Step 3: 實作**

建立 `functions/src/weather.ts`：

```ts
/**
 * Open-Meteo 的網址組裝與回應解析。純函式，不碰網路 —— 真正的 fetch 在
 * `index.ts`，這裡只負責「該問什麼」與「答案怎麼讀」。
 *
 * 選 Open-Meteo 的決定性理由是**不需要 API 金鑰**。`.env.example` 對另外兩把
 * 金鑰寫了很長的警告（用量計費、被撿去用會算你的帳單），天氣這條完全繞開。
 */

/** 支出上存的天氣。攝氏整數。 */
export interface WeatherResult {
  /** WMO 天氣代碼 0–99。決定圖示。 */
  code: number;
  /** 當日最高溫。 */
  high: number;
  /** 當日最低溫。 */
  low: number;
  /** 那個小時的實測溫度。**只有支出填了時間才有。** */
  exact: number | null;
}

export interface WeatherQuery {
  lat: number;
  lng: number;
  /** `YYYY-MM-DD`，當地日期。 */
  date: string;
  /** `YYYY-MM-DD`，用來判斷 date 是不是過去。傳進來而不是自己取，才測得到。 */
  today: string;
}

const DAILY = "weather_code,temperature_2m_max,temperature_2m_min";
const HOURLY = "temperature_2m,weather_code";

/**
 * 過去用 archive，今天與未來用 forecast。
 *
 * 這跟直覺相反 —— archive 聽起來像「舊資料」，但它**連今天都有真值**而且回溯
 * 到 1940 年，所以 forecast 那個「往回 93 天」的界線根本用不到。
 *
 * 會用 forecast 只有兩個理由，都跟未來有關：archive 拒絕未來日期（回 400），
 * 而今天用 forecast 拿到的是完整的一天 —— archive 給的是「到目前為止」，
 * 早上八點記帳會拿到「今天最高 27°」，那天其實會到 33°。
 */
export function weatherUrl(query: WeatherQuery): string {
  const past = query.date < query.today;
  const host = past
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";

  const params = new URLSearchParams({
    latitude: String(query.lat),
    longitude: String(query.lng),
    start_date: query.date,
    end_date: query.date,
    daily: DAILY,
    hourly: HOURLY,
    // 支出的日期時間是**當地時間**。不帶這個參數回的是 UTC，
    // 曼谷的 19:05 會對到當地凌晨兩點的溫度，而畫面上完全看不出來。
    timezone: "auto"
  });

  return `${host}?${params.toString()}`;
}

function roundOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * 把回應讀成 [WeatherResult]，讀不出來就回 null。
 *
 * **任何情況都不丟例外。** 天氣缺席是正常狀態 —— 沒有天氣的支出跟沒有座標的
 * 地點是同一種缺席，不該讓一筆帳存不下去。
 *
 * [time] 是支出的 `HH:MM`，空字串代表沒記時間。
 */
export function readWeather(json: unknown, time: string): WeatherResult | null {
  if (!json || typeof json !== "object") return null;

  const body = json as Record<string, any>;
  // 錯誤是 HTTP 400 加 { error: true, reason }。先看 error 再讀資料。
  if (body.error) return null;

  const code = body.daily?.weather_code?.[0];
  const high = roundOrNull(body.daily?.temperature_2m_max?.[0]);
  const low = roundOrNull(body.daily?.temperature_2m_min?.[0]);

  if (typeof code !== "number" || high === null || low === null) return null;

  return { code, high, low, exact: hourlyTemp(body, time) };
}

/**
 * 那個小時的實測溫度。
 *
 * `hourly.time` 是**當地時間、沒有時區後綴**（`2026-08-20T19:00`），所以拿支出的
 * `HH:MM` 的小時去比對就對得上，不需要任何時區換算。
 *
 * 對不到就回 null 而不是找最近的一小時：找最近的會讓「03:00 的支出配到 06:00
 * 的溫度」看起來像正常資料。
 */
function hourlyTemp(body: Record<string, any>, time: string): number | null {
  if (!time) return null;

  const hour = time.slice(0, 2);
  const times: unknown[] = body.hourly?.time ?? [];
  const index = times.findIndex(
    item => typeof item === "string" && item.slice(11, 13) === hour
  );
  if (index < 0) return null;

  return roundOrNull(body.hourly?.temperature_2m?.[index]);
}
```

- [ ] **Step 4: 跑測試確認全綠**

```bash
cd functions
npm test -- weather
```

Expected: 13 條全綠。

- [ ] **Step 5: 確認 `timezone=auto` 那條測試抓得到它要抓的東西**

把 `weatherUrl` 裡的 `timezone: "auto"` 暫時改成 `timezone: "UTC"`：

```bash
npm test -- weather
```

Expected: **「一定要帶 timezone=auto」那條紅**，其餘綠。如果全綠代表那條測試沒測到東西。

**改回來，再跑一次確認綠。**

- [ ] **Step 6: 全套測試**

```bash
cd functions
npm test
```

Expected: 既有測試 + 新的 13 條，全綠。

- [ ] **Step 7: Commit**

```bash
git add functions/src/weather.ts functions/src/weather.test.ts
git commit -F - <<'MSG'
Ask the weather API the right question in one place

The URL building and the response reading are pure functions with no
network in them, so the parts that are easy to get subtly wrong -- which
endpoint, which timezone, which hour -- are the parts a test can hold.

The endpoint split reads backwards on purpose. Archive sounds like the
old-data one, but it serves today with real values and reaches back to
1940, so forecast's 93-day window never comes up. Forecast exists here
for the future only: archive rejects tomorrow outright, and for today it
returns just the hours that have happened, which would tell someone
recording at breakfast that the day's high was 27 when it reached 33.

The daily code wins over the hourly one for the icon. A day with a
thunderstorm reads as a thunderstorm even if 19:00 happened to be
drizzle -- the icon answers what that day was like, not what was falling
at that instant.

Nothing here throws. A missing hour, a malformed body and an API error
all return null, because an expense with no weather is the same kind of
absence as a place with no coordinates and must never stop a save.
MSG
```

---

## Task 2: 雲端函式

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes：Task 1 的 `weatherUrl`、`readWeather`、`WeatherResult`。
- Produces：`lookupWeather` callable（Task 5 的前端呼叫它）、`onExpenseWeather` 觸發器。

### 2.0 為什麼是獨立的觸發器

現有的 `onExpenseCreated` 把推播的所有步驟包在同一個 `try/catch` 裡，而且有一行 `if (targets.length === 0) return;`（單人任務不通知任何人）。

天氣塞進去會有兩個問題：**Open-Meteo 掛掉會連帶讓推播不送出**，而且**單人旅程永遠不會有天氣**。分成兩個函式兩個問題都不存在。

- [ ] **Step 1: 加 import**

`functions/src/index.ts` 的 import 區，在 `import { recipientIds } from "./recipients.js";` 之後加：

```ts
import { readWeather, weatherUrl, type WeatherResult } from "./weather.js";
```

**副檔名一定是 `.js`** —— 這個套件是 ESM，寫 `./weather` 會在部署時炸。

- [ ] **Step 2: 加共用的查詢函式**

在 `const BATCH = 500;` 之後加：

```ts
/** 天氣查詢的逾時。使用者在等預覽，不能讓表單卡住。 */
const WEATHER_TIMEOUT_MS = 6000;

/**
 * 真的去打 Open-Meteo。**任何失敗都回 null，不丟例外。**
 *
 * 天氣是裝飾不是資料 —— 查不到就是沒有，跟自己打字的地點沒有座標是同一種
 * 缺席。這個原則跟報告的地圖一樣：「地圖是加分不是必要，拍不出來也照樣
 * 產得出報告」。
 */
async function fetchWeather(
  lat: number,
  lng: number,
  date: string,
  time: string
): Promise<WeatherResult | null> {
  const today = new Date().toISOString().slice(0, 10);
  const url = weatherUrl({ lat, lng, date, today });

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
    // 錯誤是 400 帶 JSON body，所以不看狀態碼直接讀 —— reason 是唯一講得出
    // 「為什麼這筆沒天氣」的東西。
    const json = await res.json();
    const result = readWeather(json, time);
    if (!result) logger.info("天氣查不到", { url, body: json });
    return result;
  } catch (err) {
    logger.info("天氣查詢失敗", { url, err: String(err) });
    return null;
  }
}
```

- [ ] **Step 3: 加 `lookupWeather` callable**

在 `deleteAccount` 那個 `onCall` 之前加：

```ts
/**
 * 表單的天氣預覽。地點與日期都有了就呼叫這裡。
 *
 * 為什麼不讓前端直接打 Open-Meteo：`functions/` 與 `src/` 是兩個獨立套件、
 * 沒有共用程式碼，前端自己查的話網頁一份、Flutter 一份、離線補寫的觸發器
 * 再一份 —— 同一段邏輯三份，分岔的症狀是「同一筆支出在手機和網頁顯示不同
 * 天氣」。
 */
export const lookupWeather = onCall({ region: REGION }, async request => {
  // 不驗證呼叫者的話，這就是一個掛在我們帳單上的公開天氣代理。
  // 只要登入就好 —— 不必是那個任務的成員，因為天氣不是任何人的秘密。
  if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");

  const { lat, lng, date, time } = request.data ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" || typeof date !== "string") {
    throw new HttpsError("invalid-argument", "需要座標與日期");
  }

  return await fetchWeather(lat, lng, date, typeof time === "string" ? time : "");
});
```

- [ ] **Step 4: 加 `onExpenseWeather` 觸發器**

在檔案末尾加：

```ts
/**
 * 補寫離線記的帳的天氣。
 *
 * **這個觸發器只服務一種情況**：使用者記帳當下沒訊號，拿不到 callable 的
 * 預覽。文件之後同步上去，這裡才跑。有預覽的那些進來時已經帶著 weather，
 * 會直接跳過。
 *
 * 刻意不併進 `onExpenseCreated`：那支函式把推播的所有步驟包在同一個
 * try/catch 裡，而且對單人任務會提早 return。併進去會讓 Open-Meteo 掛掉時
 * 推播也不送，而且單人旅程永遠不會有天氣。
 */
export const onExpenseWeather = onDocumentCreated(
  {
    document: "tasks/{taskId}/expenses/{expenseId}",
    region: REGION
  },
  async event => {
    const expense = event.data?.data();
    if (!expense) return;

    // 已經有了就不動 —— 前端存進來的預覽值優先，那是使用者看過的那個值。
    if (expense.weather) return;

    const place = expense.place as { lat?: number; lng?: number } | null | undefined;
    const lat = place?.lat;
    const lng = place?.lng;
    // 自己打字的地點沒有座標。這跟地圖是同一個限制。
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const date = typeof expense.date === "string" ? expense.date : "";
    if (!date) return;

    const weather = await fetchWeather(
      lat,
      lng,
      date,
      typeof expense.time === "string" ? expense.time : ""
    );
    if (!weather) return;

    try {
      await event.data!.ref.update({ weather });
    } catch (err) {
      // 補寫失敗就算了。這支函式的原則跟推播那支一樣：寧可少一個裝飾，
      // 也不要讓例外冒出去在雲端留一則沒人看的錯誤日誌。
      logger.info("天氣補寫失敗", { err: String(err) });
    }
  }
);
```

- [ ] **Step 5: 型別檢查與測試**

```bash
cd functions
npm run build
npm test
```

Expected: build 過、測試全綠。

- [ ] **Step 6: Commit**

```bash
git add functions/src/index.ts
git commit -F - <<'MSG'
Give weather its own trigger instead of renting space in the notifier

onExpenseCreated wraps every step in one try/catch and returns early
when a task has no one to notify. Adding weather there would have let an
Open-Meteo outage swallow push notifications, and would have left
solo trips -- the ones that take that early return -- with no weather at
all. Two functions, neither problem.

The callable exists so the form can show weather the moment a place and
date are both present, without the lookup itself moving to the client.
functions/ and src/ share no code, so a client-side fetch would be
written three times over -- web, Flutter, backfill -- and drift would
surface as one expense showing different weather on phone and web.

It checks for a signed-in caller and nothing more. Unauthenticated it
would be a public weather proxy on our bill; task membership is beside
the point, since the weather over a place is nobody's secret.

The trigger only ever fires usefully for expenses recorded offline,
where no preview was possible. Anything that arrives already carrying
weather is left alone, because that is the value the user saw.
MSG
```

---

## Task 3: Firestore 規則

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: 加 `validWeather()`**

在 `validPlace()` 那個函式之後加：

```
        /*
          天氣是選填的裝飾欄位。client 寫得了它 —— 那是表單預覽拿到的值，
          存檔時一起送上去。偽造天氣的風險可以忽略；反過來禁止 client 寫的話，
          編輯支出時前端送回整份文件就會把它洗掉，那更容易發生也更難察覺。

          exact 那組括號不能省：`A && B || C` 解析成 `(A && B) || C`，
          少了括號只要 exact 合法，前面所有檢查就全部被短路，驗證形同虛設。
        */
        function validWeather() {
          let weather = request.resource.data.get("weather", null);
          return weather == null
            || (
              weather is map
              && weather.code is int
              && weather.code >= 0
              && weather.code <= 99
              && weather.high is int
              && weather.high >= -90
              && weather.high <= 60
              && weather.low is int
              && weather.low >= -90
              && weather.low <= 60
              && (
                weather.get("exact", null) == null
                || (
                  weather.exact is int
                  && weather.exact >= -90
                  && weather.exact <= 60
                )
              )
            );
        }
```

- [ ] **Step 2: 掛進 `validExpenseShape()`**

把 `validExpenseShape()` 結尾的

```
            && validTime();
```

改成

```
            && validTime()
            && validWeather();
```

**不要動這條鏈上既有的任何一項。**

- [ ] **Step 3: 用模擬器驗證括號真的有作用**

啟動 Firestore 模擬器，用一筆 `code` 非法（例如 `150`）但 `exact` 合法（例如 `28`）的資料嘗試寫入。

```bash
firebase emulators:start --only firestore
```

Expected: **被拒絕**。如果通過了，代表括號寫掉了 —— 那正是這一步存在的理由。

沒有模擬器環境的話，這一步改成人工複核：確認 `exact` 的 `||` 整組被一對括號包住，而且那對括號在 `&&` 鏈的裡面。

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -F - <<'MSG'
Validate the weather field without loosening anything already there

A separate validWeather(), following validPlace() and validReceipt(),
hung on the end of the chain. The existing checks are untouched -- the
expense shape rules were argued over once already and adding a field is
not a reason to reopen them.

The parentheses around the optional exact are load-bearing. Without
them, `A && B || C` groups as `(A && B) || C`, so any valid exact would
short-circuit every check before it and the whole function would pass
anything. It reads fine either way, which is why the verification step
is specifically a write with a valid exact and an out-of-range code.

Clients may write this field. It is the preview value the user already
saw, and forbidding it would mean an edit -- which sends the whole
document back -- silently erases the weather.
MSG
```

---

## Task 4: 前端型別與 WMO 分組

**Files:**
- Create: `src/types/weather.ts`
- Create: `src/types/weather.test.ts`
- Modify: `src/types/expense.ts`

**Interfaces:**
- Produces：`ExpenseWeather`、`WeatherKind`、`weatherKind(code)`。Task 5–7 用。

- [ ] **Step 1: 寫會失敗的測試**

建立 `src/types/weather.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { weatherKind } from "@/types/weather";

/**
 * WMO 有 28 個代碼，畫面上只需要分辨得出「那天大概是什麼樣子」，
 * 所以收成 8 組。分組錯了的症狀是「下雪的那天顯示太陽」——
 * 沒有任何錯誤訊息，只有一個看起來很正常的錯圖示。
 */
describe("weatherKind", () => {
  it("0 是晴", () => {
    expect(weatherKind(0)).toBe("clear");
  });

  it("1–2 是多雲，3 是陰", () => {
    expect(weatherKind(1)).toBe("cloudy");
    expect(weatherKind(2)).toBe("cloudy");
    expect(weatherKind(3)).toBe("overcast");
  });

  it("45、48 是霧", () => {
    expect(weatherKind(45)).toBe("fog");
    expect(weatherKind(48)).toBe("fog");
  });

  it("51–57 是毛毛雨", () => {
    expect(weatherKind(51)).toBe("drizzle");
    expect(weatherKind(55)).toBe("drizzle");
    expect(weatherKind(57)).toBe("drizzle");
  });

  it("61–67 與 80–82 是雨", () => {
    expect(weatherKind(61)).toBe("rain");
    expect(weatherKind(65)).toBe("rain");
    expect(weatherKind(80)).toBe("rain");
    expect(weatherKind(82)).toBe("rain");
  });

  it("71–77 與 85–86 是雪", () => {
    expect(weatherKind(71)).toBe("snow");
    expect(weatherKind(77)).toBe("snow");
    expect(weatherKind(85)).toBe("snow");
  });

  it("95–99 是雷", () => {
    expect(weatherKind(95)).toBe("thunder");
    expect(weatherKind(99)).toBe("thunder");
  });

  it("認不得的代碼退回陰天，不是晴天", () => {
    // 退回晴天的話，一個查錯的代碼會變成「那天天氣很好」——
    // 那是一句沒有根據的話。陰天是最中性的說法。
    expect(weatherKind(7)).toBe("overcast");
    expect(weatherKind(-1)).toBe("overcast");
  });
});
```

- [ ] **Step 2: 跑測試確認會失敗**

```bash
npm test -- weather
```

Expected: 失敗，找不到 `@/types/weather`。

- [ ] **Step 3: 實作**

建立 `src/types/weather.ts`：

```ts
/**
 * 支出上的天氣。`functions/src/weather.ts` 的 `WeatherResult` 在前端的對應型別。
 *
 * 兩邊各自宣告而不是共用：`functions/` 與 `src/` 是兩個獨立套件。
 * 形狀要對得上，改一邊要記得改另一邊 —— 這是這個切分的已知代價。
 */
export interface ExpenseWeather {
  /** WMO 天氣代碼 0–99。 */
  code: number;
  /** 當日最高溫，攝氏整數。 */
  high: number;
  /** 當日最低溫，攝氏整數。 */
  low: number;
  /** 那個小時的實測溫度。**只有支出填了時間才有。** */
  exact: number | null;
}

/** 畫面上分辨得出來的八種天氣。 */
export type WeatherKind =
  | "clear"
  | "cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

/**
 * WMO 的 28 個代碼收成 8 組。
 *
 * 認不得的一律當陰天。**方向很重要**：退回晴天的話，一個查錯的代碼會變成
 * 「那天天氣很好」，那是一句沒有根據的話；陰天是最中性的說法。
 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return "overcast";
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npm test -- weather
```

Expected: 8 條全綠。

- [ ] **Step 5: `Expense` 加欄位**

`src/types/expense.ts`，在 `import type { Timestamp }` 之後加：

```ts
import type { ExpenseWeather } from "@/types/weather";
```

然後在 `Expense` 介面裡（找 `place` 那一欄的旁邊）加：

```ts
  /**
   * 那天那個地點的天氣。**選填**：地點沒有座標、API 查不到、或離線記帳
   * 還沒被觸發器補寫時都是 null。缺席是正常狀態。
   */
  weather?: ExpenseWeather | null;
```

- [ ] **Step 6: 型別檢查**

```bash
npm run check
```

Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add src/types/weather.ts src/types/weather.test.ts src/types/expense.ts
git commit -F - <<'MSG'
Collapse 28 weather codes into eight things a person can recognise

The icon answers "roughly what was that day like", so the WMO scale gets
grouped rather than reproduced. Getting a group wrong shows a sun over a
day it snowed, with no error anywhere -- just a plausible wrong picture
-- which is why the mapping is a pure function with the boundaries
pinned.

Unknown codes fall back to overcast, and the direction matters. Falling
back to clear would turn a lookup failure into "the weather was lovely",
which is a claim we have no basis for. Overcast is the one that asserts
least.

The type is declared again here rather than shared with functions/,
which is a real cost of those being separate packages: the two shapes
have to be kept in step by hand.
MSG
```

---

## Task 5: 表單預覽

**Files:**
- Create: `src/services/weatherService.ts`
- Create: `src/components/expense/WeatherChip.vue`
- Modify: `src/pages/ExpenseFormPage.vue`

**Interfaces:**
- Consumes：Task 2 的 `lookupWeather` callable、Task 4 的 `ExpenseWeather`／`weatherKind`。
- Produces：`WeatherChip`（Task 6、7 也用）、`lookupWeather(place, date, time)`。

- [ ] **Step 1: 建立 service**

`src/services/weatherService.ts`：

```ts
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/firebase/config";
import type { ExpenseWeather } from "@/types/weather";
import type { ExpensePlace } from "@/types/expense";

/**
 * 查一筆支出的天氣。查不到就回 null —— 呼叫端不需要區分「沒有座標」、
 * 「API 掛了」、「逾時」，那三件事對畫面是同一件事：不顯示天氣。
 *
 * 前端不直接打 Open-Meteo：查詢邏輯只寫在 `functions/` 一份，
 * 手機版之後接同一個 callable。
 */
export async function lookupWeather(
  place: ExpensePlace | null,
  date: string,
  time: string
): Promise<ExpenseWeather | null> {
  // 自己打字的地點沒有座標。這跟地圖是同一個限制。
  if (!place || place.lat === null || place.lng === null || !date) return null;

  try {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    const call = httpsCallable(getFunctions(app, "asia-east1"), "lookupWeather");
    const result = await call({ lat: place.lat, lng: place.lng, date, time });
    return (result.data as ExpenseWeather | null) ?? null;
  } catch {
    // 天氣是加分不是必要。查不到就當作沒有，不要讓使用者看到錯誤訊息。
    return null;
  }
}
```

- [ ] **Step 2: 建立 `WeatherChip.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { ExpenseWeather } from "@/types/weather";
import { weatherKind } from "@/types/weather";

const props = defineProps<{ weather: ExpenseWeather }>();

const kind = computed(() => weatherKind(props.weather.code));

/**
 * 有 exact 就印單一溫度，沒有就印當日高低。
 *
 * 這不只是格式差異 —— 它讓畫面看得出這筆支出有沒有記時間，
 * 而且不假裝出沒有的精度。
 */
const temp = computed(() =>
  props.weather.exact === null
    ? `${props.weather.low}–${props.weather.high}°`
    : `${props.weather.exact}°`
);
</script>

<template>
  <span class="weather">
    <!--
      inline SVG 不是 emoji：emoji 在不同系統上長得不一樣，而且吃不到
      currentColor。八組各一個圖示，用 stroke 畫，16px 網格。
    -->
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <template v-if="kind === 'clear'">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </template>
      <template v-else-if="kind === 'cloudy'">
        <circle cx="8" cy="8" r="3" />
        <path d="M17 19H8a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 17 19z" />
      </template>
      <template v-else-if="kind === 'overcast'">
        <path d="M16 17H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 17z" />
        <path d="M9 20h9" />
      </template>
      <template v-else-if="kind === 'fog'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M5 17h14M7 21h11" />
      </template>
      <template v-else-if="kind === 'drizzle'">
        <path d="M16 14H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 14z" />
        <path d="M9 18v1M13 18v1M17 18v1" />
      </template>
      <template v-else-if="kind === 'rain'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4" />
      </template>
      <template v-else-if="kind === 'snow'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M8 18h.01M12 20h.01M16 18h.01" />
      </template>
      <template v-else>
        <path d="M16 12H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 12z" />
        <path d="M13 15l-3 4h4l-3 5" />
      </template>
    </svg>
    <span class="num">{{ temp }}</span>
  </span>
</template>

<style scoped>
.weather {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-muted);
  font-size: var(--text-tiny);
}
</style>
```

- [ ] **Step 3: 表單接上**

`src/pages/ExpenseFormPage.vue` 的 `<script setup>`，在 `const place = ref<ExpensePlace | null>(null);`（第 106 行附近）之後加：

```ts
const weather = ref<ExpenseWeather | null>(null);
const weatherLoading = ref(false);

/**
 * 地點與日期都有了就查天氣。
 *
 * **改了任一個就重查，查不到就清空。** 停在那裡的舊天氣是「三月三號清邁的雨」
 * 配上「三月五號曼谷的晚餐」，而畫面上看不出來 —— 跟未換算支出同一個立場：
 * 寧可沒有，不要錯的。
 */
watch([place, date, time], async () => {
  weather.value = null;
  if (!place.value || place.value.lat === null || !date.value) return;

  weatherLoading.value = true;
  try {
    weather.value = await lookupWeatherFor(place.value, date.value, time.value);
  } finally {
    weatherLoading.value = false;
  }
});
```

import 區加：

```ts
import { lookupWeather as lookupWeatherFor } from "@/services/weatherService";
import WeatherChip from "@/components/expense/WeatherChip.vue";
import type { ExpenseWeather } from "@/types/weather";
```

`watch` 要從 `vue` import（檔案已經有 `ref`、`computed`，確認 `watch` 也在）。

- [ ] **Step 4: 表單顯示**

在地點欄位（`PlaceField`）之後加：

```vue
        <p v-if="weatherLoading" class="tiny">查天氣中...</p>
        <p v-else-if="weather" class="tiny">
          <WeatherChip :weather="weather" />
        </p>
```

- [ ] **Step 5: 存檔帶上**

`src/pages/ExpenseFormPage.vue` 第 377 行附近，`place: place.value,` 那一行之後加：

```ts
      weather: weather.value,
```

- [ ] **Step 6: 型別檢查與 build**

```bash
npm run check
npm run build
```

Expected: 兩個都過。

- [ ] **Step 7: 手動驗證**

需要部署好的 functions（`firebase deploy --only functions`）或模擬器。

- 選一個從搜尋清單挑出來的地點 → 出現「查天氣中...」→ 換成圖示與溫度
- 把日期改成一週前 → 重查，數字變了
- 填時間 → 從「24–33°」變成單一溫度
- 自己打字的地點 → 沒有天氣，也沒有任何錯誤訊息
- **關掉網路存一筆 → 存得下去**（這是最重要的一條）

- [ ] **Step 8: Commit**

```bash
git add src/services/weatherService.ts src/components/expense/WeatherChip.vue src/pages/ExpenseFormPage.vue
git commit -F - <<'MSG'
Show the weather while the place is still on screen

The form asks as soon as a place and a date are both present, and asks
again whenever either changes. Stale weather is the failure worth
avoiding here: Chiang Mai's rain sitting above a Bangkok dinner two days
later looks entirely normal, so a changed date clears the field rather
than keeping the old answer.

The chip prints one temperature when the expense has a time and a
high-low range when it does not. That is not just formatting -- it means
the screen shows which kind of record this is, instead of inventing a
precision the data does not have.

Every failure path returns null and renders nothing. A typed-in place
with no coordinates, a timeout, a dead API and an offline save are four
different causes of the same outcome, and none of them is worth an error
message on a screen where the user is trying to record a number.
MSG
```

---

## Task 6: 列表與明細顯示

**Files:**
- Modify: `src/components/expense/ExpenseRow.vue`
- Modify: `src/pages/ExpenseDetailPage.vue`

- [ ] **Step 1: `ExpenseRow.vue` —— 天氣掛在地點那一行**

第 75 行現在是：

```vue
      <p v-if="expense.place" class="tiny place">📍 {{ expense.place.name }}</p>
```

改成：

```vue
      <!--
        天氣掛在地點這一行，不另開一欄。列上已經有分類圖示，再並排一個
        天氣圖示是兩個圖示搶注意力 —— 而天氣本來就屬於地點，貼著它最自然。
      -->
      <p v-if="expense.place" class="tiny place">
        📍 {{ expense.place.name }}
        <WeatherChip v-if="expense.weather" :weather="expense.weather" />
      </p>
```

`<script setup>` 加：

```ts
import WeatherChip from "@/components/expense/WeatherChip.vue";
```

- [ ] **Step 2: `ExpenseDetailPage.vue` —— 地點區加天氣**

找到顯示地點名稱的那一段，在它之後加：

```vue
        <p v-if="expense.weather" class="tiny">
          <WeatherChip :weather="expense.weather" />
        </p>
```

`<script setup>` 加同一行 import。

- [ ] **Step 3: 型別檢查與 build**

```bash
npm run check
npm run build
```

- [ ] **Step 4: 目視確認**

支出列表裡有天氣的那幾筆，圖示與溫度接在地點後面，沒有換行也沒有把金額擠掉。窄螢幕（390px）要特別看。

- [ ] **Step 5: Commit**

```bash
git add src/components/expense/ExpenseRow.vue src/pages/ExpenseDetailPage.vue
git commit -F - <<'MSG'
Put the weather next to the place it belongs to

The expense row already carries a category icon. A second icon sitting
beside it would be two pictures competing for the same glance, so the
weather joins the place line instead -- which is also where it belongs,
since it is a fact about that location on that day rather than about the
expense.

Rows without weather are unchanged. Nothing marks their absence.
MSG
```

---

## Task 7: 報告時間軸

**Files:**
- Modify: `src/utils/reportTimeline.ts`
- Modify: `src/utils/reportTimeline.test.ts`（不存在就建立）
- Modify: `src/composables/useTripReport.ts`
- Modify: `src/pages/ReportPage.vue`

**Interfaces:**
- Consumes：Task 4 的 `ExpenseWeather`、Task 5 的 `WeatherChip`。

- [ ] **Step 1: 寫會失敗的測試**

在 `src/utils/reportTimeline.test.ts` 加一個 group（沿用檔案裡既有的 `Expense` 建構輔助函式；沒有的話照既有測試的寫法建一個）：

```ts
describe("每天的天氣", () => {
  const sunny = { code: 0, high: 30, low: 22, exact: null };
  const stormy = { code: 95, high: 28, low: 21, exact: null };

  it("取當天第一筆有天氣的支出", () => {
    const days = reportTimeline(
      [
        expense({ date: "2026-03-01", time: "09:00", weather: stormy }),
        expense({ date: "2026-03-01", time: "18:00", weather: sunny })
      ],
      "TWD"
    );

    expect(days[0].weather).toEqual(stormy);
  });

  it("前面幾筆沒有天氣就往後找", () => {
    const days = reportTimeline(
      [
        expense({ date: "2026-03-01", time: "09:00" }),
        expense({ date: "2026-03-01", time: "18:00", weather: sunny })
      ],
      "TWD"
    );

    expect(days[0].weather).toEqual(sunny);
  });

  it("整天都沒有就是 null，不是硬湊一個", () => {
    const days = reportTimeline([expense({ date: "2026-03-01" })], "TWD");

    expect(days[0].weather).toBeNull();
  });

  it("每一天各自算，不會沿用前一天的", () => {
    const days = reportTimeline(
      [
        expense({ date: "2026-03-01", weather: stormy }),
        expense({ date: "2026-03-02" })
      ],
      "TWD"
    );

    expect(days[0].weather).toEqual(stormy);
    expect(days[1].weather).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認會失敗**

```bash
npm test -- reportTimeline
```

Expected: 新的四條紅（`weather` 不存在於 `ReportDay`）。

- [ ] **Step 3: 實作**

`src/utils/reportTimeline.ts`，`ReportDay` 加一欄：

```ts
export interface ReportDay {
  /** `"YYYY-MM-DD"`。 */
  date: string;
  /** 旅程的第幾天，從 1 起算。 */
  day: number;
  /** 當天小計。 */
  total: number;
  /**
   * 當天的天氣，取**當天第一筆有天氣的支出**。
   *
   * 掛在「天」不掛在「筆」：同一天三筆支出印三次一樣的天氣是噪音，
   * 而公開文件也小一點。
   *
   * 一天跨兩個城市時會顯示第一個 —— 這是已知且接受的不精確。替代方案
   * （取眾數、列出全部）都讓規則變得沒辦法一句話講完，而報告是給不在場
   * 的人看的，那個精度沒有意義。
   */
  weather: ExpenseWeather | null;
  entries: ReportEntry[];
}
```

import 加：

```ts
import type { ExpenseWeather } from "@/types/weather";
```

在建立新的一天時（`days.set(...)` 那裡）把 `weather: null` 加進去，然後在每一筆支出處理完之後加：

```ts
    // 第一筆有天氣的說了算。已經有了就不覆蓋 —— 「第一筆」的定義靠的是
    // 上面那個 ordered（由舊到新），不是傳入順序。
    if (day.weather === null && expense.weather) day.weather = expense.weather;
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npm test -- reportTimeline
```

Expected: 新的四條加既有的全綠。

- [ ] **Step 5: `ReportPage.vue` 顯示**

第 267 行現在是：

```vue
            <span class="name day-head">Day {{ day.day }} · {{ dayLabel(day.date) }}</span>
```

改成：

```vue
            <span class="name day-head">
              Day {{ day.day }} · {{ dayLabel(day.date) }}
              <!-- 舊報告沒有這個欄位，所以一定要用 v-if 而不是假設它存在。 -->
              <WeatherChip v-if="day.weather" :weather="day.weather" />
            </span>
```

`<script setup>` 加 import。

- [ ] **Step 6: 確認 `useTripReport` 不用改**

```bash
grep -n "reportTimeline" src/composables/useTripReport.ts
```

它呼叫的是 `reportTimeline(expenses, currency, task.startDate)`，天氣是在 `reportTimeline` 裡從 expenses 讀出來的，**所以這個檔案不用改**。確認一下就好，不要為了打勾去動它。

- [ ] **Step 7: 型別檢查與 build**

```bash
npm run check
npm run build
```

- [ ] **Step 8: 目視確認**

需要一份有天氣的報告：先在有支出且有地點的任務上記幾筆帶天氣的支出 → 封存 → 產生報告。

- 日表頭顯示 `Day 1 · 3月1日 · 🌧 24–33°`
- 舊報告（沒有 weather 的）打開不會壞掉，只是沒有天氣

- [ ] **Step 9: Commit**

```bash
git add src/utils/reportTimeline.ts src/utils/reportTimeline.test.ts src/pages/ReportPage.vue
git commit -F - <<'MSG'
Let the report say what the day was like

Weather hangs off the day, not the entry. Three expenses on one day
printing the same icon three times is noise, and the public document
stays smaller for it.

The day takes its weather from the first expense that has any. A day
spanning two cities therefore shows the first city's, which is a known
inaccuracy and the accepted one: every alternative -- most common, list
them all -- costs the rule its one-sentence explanation, and this page
is read by people who were not there.

reportTimeline already receives the expenses, so useTripReport needed no
change at all. Older reports have no weather field and the template
checks rather than assumes.
MSG
```

---

## Task 8: 驗收

- [ ] **Step 1: 自動檢查**

```bash
cd functions && npm test && npm run build
cd .. && npm run check && npm run build
```

Expected: 全綠。

- [ ] **Step 2: 掃描**

```bash
grep -rn "weathercode" functions/src/ src/     # 預期：無（正確的是 weather_code）
grep -rn "open-meteo" src/                     # 預期：無（前端不該碰 Open-Meteo）
grep -n "validWeather" firestore.rules         # 預期：2（宣告 1 + 使用 1）
grep -c "from \"./weather\"" functions/src/index.ts  # 預期：0（ESM 要 .js）
```

第二條特別重要：**前端出現 `open-meteo` 就代表有人把查詢邏輯搬到前端了**，那正是這個設計要避免的三份實作。

- [ ] **Step 3: 確認 `timezone=auto` 的測試會失敗於錯誤實作**

把 `weatherUrl` 的 `timezone: "auto"` 改成 `"UTC"`，跑 `cd functions && npm test`。

Expected: 那一條紅。**改回來再跑一次確認綠。**

- [ ] **Step 4: 走查 —— 記一筆有天氣的支出**

從搜尋清單選地點 → 出現讀取中 → 圖示與溫度。改日期會重查。填時間會從範圍變成單一溫度。

- [ ] **Step 5: 走查 —— 沒有天氣的三種情況**

自己打字的地點、關掉網路存的一筆、日期填成很久很久以前（1930 年，兩個 endpoint 都涵蓋不到）。三種都要**存得下去而且沒有錯誤訊息**。

- [ ] **Step 6: 走查 —— 離線補寫**

關網路記一筆有座標地點的支出 → 開網路等同步 → 幾秒後列表上出現天氣。

這一條是 `onExpenseWeather` 存在的唯一理由，一定要驗。

- [ ] **Step 7: 走查 —— 報告**

產生一份報告，日表頭有天氣。再打開一份**這次改動之前產生的舊報告**，確認沒有壞掉。

- [ ] **Step 8: Commit（若有修正）**

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §2 資料形狀 | Task 4 Step 5（前端）、Task 1 Step 3（後端） |
| §2 firestore.rules | Task 3 |
| §3 兩個 endpoint 與分流 | Task 1 Step 1、Step 3 |
| §3 參數與回應形狀 | Task 1 Step 1 的 `RESPONSE` 常數 |
| §3 錯誤是 400 加 JSON body | Task 1「錯誤回應回 null」那條測試、Task 2 Step 2 |
| §3 `timezone=auto` | Task 1 Step 1、Step 5，Task 8 Step 3 |
| §4 三個進入點 | Task 2（callable + 觸發器）、§8 不回填 |
| §4 獨立觸發器 | Task 2 §2.0、Step 4 |
| §4 callable 擋未登入 | Task 2 Step 3 |
| §5 WMO → 8 組 | Task 4 |
| §5 四個顯示位置 | Task 5（表單）、Task 6（列表、明細）、Task 7（報告） |
| §5 報告掛在天 | Task 7 |
| §6 改了就重查、查不到清空 | Task 5 Step 3 的 `watch` |
| §7 失敗是正常狀態、不擋存檔 | Task 1 Step 3、Task 5 Step 1、Task 8 Step 5 |
| §8 不做的事 | Global Constraints |
| §9 測試策略 | Task 1、4、7 的 TDD 步驟 |
| §10 會動到的檔案 | File Structure |

**型別一致性：**

- `WeatherResult`（functions）與 `ExpenseWeather`（src）欄位相同：`code`／`high`／`low`／`exact`。兩邊各自宣告是刻意的，Task 4 Step 3 的註解寫明了這個代價。
- `weatherUrl(query: WeatherQuery)` 在 Task 1 定義，Task 2 Step 2 使用 —— 參數名 `lat`／`lng`／`date`／`today` 一致。
- `readWeather(json, time)` 在 Task 1 定義，Task 2 Step 2 使用。
- `weatherKind(code)` 在 Task 4 定義，Task 5 Step 2 的 `WeatherChip` 使用。
- `lookupWeather` 這個名字**同時是 callable 的名字與前端 service 的函式名**。Task 5 Step 3 的 import 用 `as lookupWeatherFor` 別名避開跟 ref 命名衝突 —— 這是刻意的，不是筆誤。

**已知的不確定：**

- Task 7 Step 1 假設 `src/utils/reportTimeline.test.ts` 存在且有建構 `Expense` 的輔助函式。**沒有的話照既有測試的寫法建一個**，不要為了省事改成用真實資料。
- Task 6 Step 2 的 `ExpenseDetailPage.vue` 地點區位置沒有寫死行號 —— 那個檔案這一輪之前沒讀過，實作時以實際結構為準。
