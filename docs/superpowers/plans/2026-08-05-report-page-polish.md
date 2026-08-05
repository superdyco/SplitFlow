# 旅費報告頁改版與地圖載入優化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓公開旅費報告頁有明確的視覺主角與長條視覺化，並讓地圖從三段串行請求變成兩段、載入期間不再造成版面位移。

**Architecture:** 兩支新的純函式模組（URL 組合、地點顯示規則）先以 TDD 完成，再由一個新的長條元件與改寫後的 `ReportPage.vue` 消費。地圖改用直接組出的 Storage REST 網址，不再動態載入 `firebase/storage`。最後在 `TaskPage.vue` 分享區補一顆「開啟」。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Vite、Vitest、Firebase Firestore／Storage。

## Global Constraints

- 規格文件：`docs/superpowers/specs/2026-08-05-report-page-polish-design.md`
- **`ReportPage.vue` 絕對不可以 import `@/services/staticMap`。** 那個檔有
  `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`，Vite 會在 build 時把值字面內嵌進 chunk，
  而報告連結設計上就是要到處轉傳。
- **`ReportPage.vue` 不可以 import `firebase/storage`。**
- 不新增任何 npm 相依。
- 不改 `TripReport` 的資料形狀，也不改 `firestore.rules` 與 `storage.rules`。
- 註解用繁體中文，寫「為什麼」不寫「做什麼」，跟既有程式碼一致。
- 測試描述用繁體中文，說明這個測試在守什麼，跟 `tests/staticMap.test.ts` 一致。
- 金額一律用 `formatAmount(amount, currency)`（`@/utils/currency`）。
- 每個 Task 結束時 `npm test` 必須全綠。

---

### Task 1: `reportMap.ts` — 地圖網址組合

**Files:**
- Create: `src/services/reportMap.ts`
- Create: `tests/reportMap.test.ts`
- Modify: `src/services/staticMap.ts`（移除 `reportMapPath` 定義與匯出）
- Modify: `src/composables/useTripReport.ts:24`（import 來源）
- Modify: `tests/staticMap.test.ts`（移走 `reportMapPath` 的 describe 區塊）

**Interfaces:**
- Consumes: 無
- Produces:
  - `reportMapPath(taskId: string, reportId: string): string`
  - `reportMapUrl(taskId: string, reportId: string): string`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/reportMap.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMapPath, reportMapUrl } from "@/services/reportMap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportMapPath", () => {
  // 這個路徑必須跟 storage.rules 裡公開讀取的那條 match 對得起來，
  // 對不上的話圖傳得上去但公開頁面讀不到。
  it("對得上 storage.rules 的公開路徑", () => {
    expect(reportMapPath("t1", "r1")).toBe("tasks/t1/reports/r1/map.png");
  });
});

describe("reportMapUrl", () => {
  it("斜線要編碼成 %2F —— Storage REST 把整個物件名稱當成單一路徑參數", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "demo.appspot.com");

    expect(reportMapUrl("t1", "r1")).toBe(
      "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/" +
        "tasks%2Ft1%2Freports%2Fr1%2Fmap.png?alt=media"
    );
  });

  it("一定要帶 alt=media —— 少了它拿到的是物件的 JSON metadata 而不是圖片", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "demo.appspot.com");

    expect(reportMapUrl("t1", "r1")).toContain("?alt=media");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/reportMap.test.ts`
Expected: FAIL，訊息是找不到模組 `@/services/reportMap`

- [ ] **Step 3: 寫實作**

建立 `src/services/reportMap.ts`：

```ts
/**
 * 公開報告地圖的路徑與網址。
 *
 * **這個模組刻意獨立於 `staticMap.ts`。** 那裡有
 * `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`，而 Vite 會在 build 時把 env 的值
 * 字面內嵌進 chunk。報告連結設計上就是要到處轉傳，不能夾帶金鑰 ——
 * 所以「公開頁只碰得到這個檔」必須由模組邊界保證，不能賭 tree-shaking。
 *
 * 純字串組合，不 import firebase 也不 import vue。
 */

const STORAGE_HOST = "https://firebasestorage.googleapis.com/v0/b";

export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}

/**
 * 直接組出下載網址，不呼叫 `getDownloadURL()`。
 *
 * 成立的前提是 storage.rules 對這個路徑是 `allow read: if true` —— 那條規則
 * 本來就是為了「沒登入的人也要看得到圖」而存在的，不是巧合。日後若收緊，
 * 這裡要一起改。
 *
 * 換來的是省掉一次 firebase/storage 的 chunk 下載與一次 API 往返，
 * 地圖從三段串行變成兩段。
 *
 * 路徑必須整段 encode，`/` 要變成 `%2F`：REST 端點把物件名稱當成單一路徑參數。
 */
export function reportMapUrl(taskId: string, reportId: string): string {
  const bucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
  return `${STORAGE_HOST}/${bucket}/o/${encodeURIComponent(reportMapPath(taskId, reportId))}?alt=media`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/reportMap.test.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: 把 `reportMapPath` 從 `staticMap.ts` 移除**

在 `src/services/staticMap.ts` 刪掉這一段（含上方註解）：

```ts
export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}
```

**不要留 re-export。** 留了的話「公開頁不准碰 `staticMap.ts`」就只是口頭約定，
下一個人從那裡 import 路徑函式不會遇到任何阻力。

- [ ] **Step 6: 改 `useTripReport.ts` 的 import**

`src/composables/useTripReport.ts:24` 現在是：

```ts
import { fetchStaticMap, MAX_MAP_BYTES, reportMapPath } from "@/services/staticMap";
```

改成兩行：

```ts
import { fetchStaticMap, MAX_MAP_BYTES } from "@/services/staticMap";
import { reportMapPath } from "@/services/reportMap";
```

- [ ] **Step 7: 把 `reportMapPath` 的測試移出 `staticMap.test.ts`**

刪掉 `tests/staticMap.test.ts` 檔尾整個 `describe("reportMapPath", ...)` 區塊
（它已經原封不動搬到 `tests/reportMap.test.ts`），並把 import 改成：

```ts
import { mappablePlaces } from "@/services/staticMap";
```

- [ ] **Step 8: 全測試 + 型別檢查**

Run: `npm test`
Expected: PASS，總數比原本多 2（`reportMapPath` 那個是搬移不是新增）

Run: `npm run check`
Expected: 無錯誤

- [ ] **Step 9: Commit**

```bash
git add src/services/reportMap.ts src/services/staticMap.ts src/composables/useTripReport.ts tests/reportMap.test.ts tests/staticMap.test.ts
git commit -m "Build the report map URL without the storage SDK"
```

---

### Task 2: `reportPlaces.ts` — 地點列表的顯示規則

**Files:**
- Create: `src/utils/reportPlaces.ts`
- Create: `tests/reportPlaces.test.ts`

**Interfaces:**
- Consumes: `PlaceTotal`、`NO_PLACE_LABEL`（`@/utils/placeTotals`，已存在）
- Produces:
  - `PLACE_LIMIT: number`
  - `interface PlaceRow extends PlaceTotal { bar: number | null }`
  - `interface VisiblePlaces { rows: PlaceRow[]; hiddenCount: number }`
  - `visiblePlaces(places: PlaceTotal[], limit?: number): VisiblePlaces`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/reportPlaces.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { visiblePlaces } from "@/utils/reportPlaces";
import { NO_PLACE_LABEL, type PlaceTotal } from "@/utils/placeTotals";

function place(overrides: Partial<PlaceTotal> = {}): PlaceTotal {
  return {
    name: "大皇宮",
    placeId: "p_palace",
    lat: 13.75,
    lng: 100.49,
    total: 10000,
    expenseCount: 1,
    ...overrides
  };
}

describe("visiblePlaces", () => {
  it("最多顯示 8 個，其餘回報成 hiddenCount", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      place({ name: `地點${index}`, total: 1000 - index })
    );
    const result = visiblePlaces(many);

    expect(result.rows).toHaveLength(8);
    expect(result.hiddenCount).toBe(3);
  });

  it("沒有超過上限時 hiddenCount 是 0", () => {
    expect(visiblePlaces([place()]).hiddenCount).toBe(0);
  });

  it("金額最大的地點長條滿格", () => {
    const result = visiblePlaces([place({ total: 8000 }), place({ name: "廟", total: 2000 })]);

    expect(result.rows[0].bar).toBe(1);
    expect(result.rows[1].bar).toBe(0.25);
  });

  // 「未指定地點」不是目的地，是把剩下的錢交代清楚的那一列。
  // 畫長條會讓人以為那是個花很多錢的地方。
  it("未指定地點不畫長條", () => {
    const result = visiblePlaces([
      place({ total: 5000 }),
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 3000 })
    ]);

    expect(result.rows[1].bar).toBeNull();
  });

  // placeTotals 把「未指定地點」固定排最後，但它的金額可能是全場最大。
  // 拿它當基準的話，真正的地點全部都不會滿格。
  it("未指定地點金額最大時，不影響其他地點的長條基準", () => {
    const result = visiblePlaces([
      place({ name: "大皇宮", total: 4000 }),
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 90000 })
    ]);

    expect(result.rows[0].bar).toBe(1);
  });

  // 基準取「顯示出來的」最大值：被收起來的那些使用者看不到，
  // 拿看不到的東西當基準會讓第一列莫名其妙不滿格。
  it("基準只看顯示出來的那幾個", () => {
    const rows = [place({ name: "A", total: 100 }), place({ name: "B", total: 50 })];

    expect(visiblePlaces(rows, 1).rows[0].bar).toBe(1);
  });

  it("全部都是未指定地點時不會除以零", () => {
    const result = visiblePlaces([
      place({ name: NO_PLACE_LABEL, placeId: null, lat: null, lng: null, total: 500 })
    ]);

    expect(result.rows[0].bar).toBeNull();
  });

  it("空陣列不會爆", () => {
    expect(visiblePlaces([])).toEqual({ rows: [], hiddenCount: 0 });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/reportPlaces.test.ts`
Expected: FAIL，找不到模組 `@/utils/reportPlaces`

- [ ] **Step 3: 寫實作**

建立 `src/utils/reportPlaces.ts`：

```ts
/**
 * 公開報告的地點列表顯示規則：截斷數量、算長條比例。
 *
 * 抽出來是為了讓這幾條規則測得到 —— 塞在元件的 computed 裡就只能靠眼睛驗。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import { NO_PLACE_LABEL, type PlaceTotal } from "@/utils/placeTotals";

/**
 * 超過這個數量就收起來。地圖標記上限是 20，二十幾列會把報告拉得很長，
 * 而報告要傳給沒去的人看，越短越有人看完。
 */
export const PLACE_LIMIT = 8;

export interface PlaceRow extends PlaceTotal {
  /** 長條長度，0-1。「未指定地點」是 null，代表不畫。 */
  bar: number | null;
}

export interface VisiblePlaces {
  rows: PlaceRow[];
  /** 收起來沒顯示的地點數。沒有收起任何東西時是 0。 */
  hiddenCount: number;
}

export function visiblePlaces(places: PlaceTotal[], limit = PLACE_LIMIT): VisiblePlaces {
  const shown = places.slice(0, limit);

  // 基準有兩個講究：
  // 一、只看顯示出來的 —— 被收起來的使用者看不到，拿它當基準會讓第一列不滿格。
  // 二、排除「未指定地點」—— placeTotals 把它固定排最後，但它的金額可能是全場
  //     最大（一堆沒填地點的支出加總起來），拿它當基準會讓真正的地點全部縮水。
  const maxTotal = Math.max(
    0,
    ...shown.filter(row => row.name !== NO_PLACE_LABEL).map(row => row.total)
  );

  return {
    rows: shown.map(row => ({
      ...row,
      bar: row.name === NO_PLACE_LABEL || maxTotal <= 0 ? null : row.total / maxTotal
    })),
    hiddenCount: Math.max(0, places.length - shown.length)
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/reportPlaces.test.ts`
Expected: PASS（8 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/utils/reportPlaces.ts tests/reportPlaces.test.ts
git commit -m "Decide which report places get a row and a bar"
```

---

### Task 3: `ReportBar.vue` — 長條元件

**Files:**
- Create: `src/components/report/ReportBar.vue`

**Interfaces:**
- Consumes: 無
- Produces: 元件 props `{ value: number; soft?: boolean }`，`value` 為 0-1

不寫測試：這是純視覺元件，行為只有「寬度等於 value」，測了也只是把樣式抄一遍。
數值計算的部分已經在 Task 2 測過了。

- [ ] **Step 1: 建立元件**

建立 `src/components/report/ReportBar.vue`：

```vue
<script setup lang="ts">
/**
 * 報告裡的水平長條。
 *
 * 兩種用途的基準不同（分類是佔總額百分比、地點是相對於最大值的比例），
 * 但都在呼叫端換算成 0-1 再傳進來 —— 元件不需要知道那個差別。
 */
import { computed } from "vue";

const props = defineProps<{
  /** 0-1。超出範圍會被夾住，資料異常時不會撐破版面。 */
  value: number;
  /** 地點用淡版，才不會跟分類的長條搶視覺重量。 */
  soft?: boolean;
}>();

const width = computed(() => `${Math.min(1, Math.max(0, props.value)) * 100}%`);
</script>

<template>
  <div class="track">
    <div class="fill" :class="{ soft }" :style="{ width }" />
  </div>
</template>

<style scoped>
.track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--color-line);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
}

/*
  用透明度而不是 --color-primary-soft：後者是 #fff0e4，那是給卡片底色用的，
  當長條會淡到看不出長度。
*/
.soft {
  opacity: 0.35;
}
</style>
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/components/report/ReportBar.vue
git commit -m "Add the horizontal bar used by both report lists"
```

---

### Task 4: `ReportPage.vue` 版面重排

地圖的載入方式在這個 Task **完全不動**（還是 `getDownloadURL`），只搬位置。
換載入方式是 Task 5 的事，兩件事分開才審得清楚。

**Files:**
- Modify: `src/pages/ReportPage.vue`

**Interfaces:**
- Consumes: `visiblePlaces`（Task 2）、`ReportBar`（Task 3）
- Produces: 無

- [ ] **Step 1: 改 `<script setup>`**

在 `src/pages/ReportPage.vue` 的 import 區塊補上：

```ts
import ReportBar from "@/components/report/ReportBar.vue";
import { visiblePlaces } from "@/utils/reportPlaces";
```

在 `dateRange` 這個 computed 後面加兩個：

```ts
const places = computed(() => visiblePlaces(report.value?.places ?? []));

/**
 * `updatedAt` 是 serverTimestamp，寫入當下的本機快照可能還沒解析成 Timestamp。
 * 公開頁是從伺服器讀的所以正常都有，但拿不到時不該讓整頁掛掉。
 */
const generatedAt = computed(() => {
  const value = report.value?.updatedAt;
  if (!value?.toDate) return "";
  return value.toDate().toLocaleDateString("zh-TW");
});
```

- [ ] **Step 2: 改 `<template>`**

把 `<template v-else-if="report">` 整個區塊換成：

```vue
    <template v-else-if="report">
      <h1 class="title center">{{ report.taskName }}</h1>
      <p class="tiny center">
        <template v-if="dateRange">{{ dateRange }} · </template>
        <template v-if="report.days">{{ report.days }} 天 · </template>
        {{ report.memberCount }} 人
      </p>

      <section class="card hero">
        <p class="tiny">每人平均</p>
        <strong class="figure">
          {{ report.currency }} {{ formatAmount(report.perPerson, report.currency) }}
        </strong>
        <p class="tiny">
          總花費 {{ report.currency }} {{ formatAmount(report.total, report.currency) }} ·
          {{ report.expenseCount }} 筆 · {{ report.places.length }} 個地點
        </p>
      </section>

      <section v-if="report.categories.length" class="card stack">
        <strong class="section-title">花在哪</strong>
        <div v-for="item in report.categories" :key="item.category" class="entry">
          <div class="line">
            <span class="name">
              {{ categoryMeta(item.category).icon }} {{ categoryMeta(item.category).label }}
            </span>
            <span class="tiny count">{{ Math.round(item.share) }}%</span>
            <span class="amount">{{ formatAmount(item.total, report.currency) }}</span>
          </div>
          <ReportBar :value="item.share / 100" />
        </div>
      </section>

      <img v-if="mapUrl" :src="mapUrl" alt="去過的地方" class="map" />

      <section v-if="places.rows.length" class="card stack">
        <strong class="section-title">去過的地方</strong>
        <div v-for="row in places.rows" :key="row.name" class="entry">
          <div class="line">
            <span class="name">{{ row.name }}</span>
            <span class="tiny count">{{ row.expenseCount }} 筆</span>
            <span class="amount">{{ formatAmount(row.total, report.currency) }}</span>
          </div>
          <ReportBar v-if="row.bar !== null" :value="row.bar" soft />
        </div>
        <p v-if="places.hiddenCount" class="tiny">還有 {{ places.hiddenCount }} 個地點</p>
      </section>

      <p class="tiny center footer">
        <template v-if="generatedAt">產生於 {{ generatedAt }} · </template>
        由 <a href="/">SplitFlow</a> 產生
      </p>
    </template>
```

- [ ] **Step 3: 改 `<style scoped>`**

把 `.headline` 與 `.figure` 兩條規則換成下面這組（其餘規則保留不動）：

```css
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 24px 18px;
  text-align: center;
  background: var(--color-primary-soft);
  border-color: var(--color-primary-soft);
}

.figure {
  font-size: 46px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
```

`.page` 的 `gap` 是 16px，`.hero` 的 `margin-bottom: 8px` 讓它與下一張卡拉開成 24px。

- [ ] **Step 4: 型別檢查與測試**

Run: `npm run check`
Expected: 無錯誤

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 人工驗收**

Run: `npm run dev`，開一個已產生報告的公開連結。確認：

1. 「每人平均」明顯是主角（淡橘底、46px 數字），三個區塊不再等重
2. 分類每列下方有橘色長條，長度符合百分比
3. 地點每列下方有淡色長條，金額最大的滿格
4. 「未指定地點」那列**沒有**長條
5. 地點超過 8 個時只顯示 8 列並出現「還有 N 個地點」
6. footer 出現「產生於 YYYY/M/D」

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReportPage.vue
git commit -m "Give the trip report a single focal point"
```

---

### Task 5: 地圖直接組 URL＋骨架屏

**Files:**
- Modify: `src/pages/ReportPage.vue`

**Interfaces:**
- Consumes: `reportMapUrl`（Task 1）
- Produces: 無

- [ ] **Step 1: 改 `<script setup>` 的 import 與狀態**

補上 import：

```ts
import { reportMapUrl } from "@/services/reportMap";
```

把 `const mapUrl = ref<string | null>(null);` 換成：

```ts
const mapLoaded = ref(false);
const mapFailed = ref(false);

/**
 * `mapPath` 是 null 就完全不渲染地圖區塊，也不發任何請求。
 *
 * 網址由路由參數組出來，跟文件裡的 `mapPath` 等價 —— `useTripReport` 寫進去的
 * 就是 `reportMapPath(taskId, reportId)`。這裡只拿 `mapPath` 當「有沒有圖」的旗標。
 */
const mapSrc = computed(() => (report.value?.mapPath ? reportMapUrl(taskId, reportId) : null));
```

- [ ] **Step 2: 把 `load()` 裡取網址的那段刪掉**

`load()` 現在的結尾是：

```ts
  const path = report.value?.mapPath;
  if (!path) return;
  try {
    const { getDownloadURL, getStorage, ref: storageRef } = await import("firebase/storage");
    const { app } = await import("@/firebase/config");
    mapUrl.value = await getDownloadURL(storageRef(getStorage(app), path));
  } catch {
    // 沒有地圖不影響其他內容。
    mapUrl.value = null;
  }
```

整段刪除。`load()` 到 `finally` 為止就結束。

同時把函式頂端註解區塊裡提到 Storage 的敘述留著不動（那段講的是「不載 Maps SDK」，
仍然成立）。

- [ ] **Step 3: 改 `<template>` 的地圖那一行**

把：

```vue
      <img v-if="mapUrl" :src="mapUrl" alt="去過的地方" class="map" />
```

換成：

```vue
      <!--
        骨架先把 8:5 的位置佔住（對應 640x400 的靜態地圖），圖載完才淡入。
        用 v-show 而不是 v-if：v-if 會讓 <img> 在載完前不存在，等於沒開始下載。
      -->
      <div v-if="mapSrc && !mapFailed" class="map-slot">
        <div v-if="!mapLoaded" class="map-skeleton" />
        <img
          v-show="mapLoaded"
          :src="mapSrc"
          alt="去過的地方"
          class="map"
          @load="mapLoaded = true"
          @error="mapFailed = true"
        />
      </div>
```

- [ ] **Step 4: 加骨架屏樣式**

在 `<style scoped>` 裡，把 `.map` 那條規則換成：

```css
.map-slot {
  position: relative;
  aspect-ratio: 8 / 5;
}

.map,
.map-skeleton {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  border: 1px solid var(--color-line);
}

.map {
  object-fit: cover;
  animation: fade-in 0.3s ease;
}

.map-skeleton {
  background: linear-gradient(
    90deg,
    var(--color-line) 25%,
    var(--color-surface) 50%,
    var(--color-line) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 5: 型別檢查與測試**

Run: `npm run check`
Expected: 無錯誤

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 驗證 chunk 沒有把金鑰或 storage 帶進來**

Run: `npm run build`
Expected: 成功，`check-chunks.mjs` 不報循環相依

接著人工確認產物。先找出報告頁的 chunk：

```bash
grep -rl "找不到這份報告" dist/assets/*.js
```

對那個檔（以及它 import 的同層 chunk）確認：

```bash
grep -c "firebasestorage.googleapis.com" dist/assets/<報告頁 chunk>.js
```
Expected: 1 以上（我們自己組的網址）

用 `.env` 裡 `VITE_GOOGLE_MAPS_API_KEY` 的實際值去搜整個 dist：

```bash
grep -rl "<把 .env 裡的金鑰貼進來>" dist/assets/
```
Expected: **報告頁的 chunk 不在結果裡**

- [ ] **Step 7: 人工驗收**

Run: `npm run dev`，開公開報告連結，開瀏覽器 DevTools 的 Network 面板，重新整理。確認：

1. **沒有** `firebase-storage-*.js` 這個 chunk 的請求
2. **沒有** 對 `firebasestorage.googleapis.com/v0/b/.../o/...` 的 **metadata**（不帶 `alt=media`）請求
3. 有一筆 `...map.png?alt=media` 的圖片請求
4. 用 Network 的 Slow 3G 節流重載：地圖位置一開始就是骨架、微光在跑，**下方的「去過的地方」不會被推走**
5. 開一個沒有地圖的報告（`mapPath` 是 null）：整塊地圖區域不存在，Network 沒有任何圖片請求

- [ ] **Step 8: Commit**

```bash
git add src/pages/ReportPage.vue
git commit -m "Load the report map without waiting on the storage SDK"
```

---

### Task 6: 分享區加「開啟」

**Files:**
- Modify: `src/pages/TaskPage.vue:306-312`

**Interfaces:**
- Consumes: `reportState.shareUrl`、`reportState.report`（皆已存在）
- Produces: 無

- [ ] **Step 1: 改 template**

`src/pages/TaskPage.vue` 裡這一段：

```vue
            <div class="row">
              <input :value="reportState.shareUrl.value" class="input grow" readonly />
              <button class="btn btn-sm" @click="copyShareUrl">
                {{ reportCopied ? "已複製" : "複製" }}
              </button>
            </div>
```

換成：

```vue
            <div class="row wrap">
              <input :value="reportState.shareUrl.value" class="input grow" readonly />
              <button class="btn btn-sm" @click="copyShareUrl">
                {{ reportCopied ? "已複製" : "複製" }}
              </button>
              <!--
                只在連結開著時才給這顆。規則是
                `active == true || isTaskMember(taskId)`，owner 是成員，所以連結
                關掉之後 owner 自己還是讀得到完整報告 —— 這時給一顆「開啟」，
                他會看到正常的頁面、以為連結還通著，但別人打開是「找不到」。
                旁邊那句「目前已關閉，連結打不開」已經把狀態講清楚了。

                用 <a> 而不是 button + window.open()：中鍵開新分頁、長按選單、
                「複製連結網址」都會是瀏覽器原生行為，也不會被彈出視窗封鎖擋掉。
              -->
              <a
                v-if="reportState.report.value.active"
                class="btn btn-sm"
                :href="reportState.shareUrl.value"
                target="_blank"
                rel="noopener"
              >
                開啟
              </a>
            </div>
```

- [ ] **Step 2: 加換行樣式**

在 `src/pages/TaskPage.vue` 的 `<style scoped>` 末尾加：

```css
/* 網址很長，手機寬度下輸入框佔滿一行、兩顆按鈕落到下一行，不要硬擠。 */
.wrap {
  flex-wrap: wrap;
}

.wrap .grow {
  flex: 1 1 100%;
}
```

- [ ] **Step 3: 型別檢查與測試**

Run: `npm run check`
Expected: 無錯誤

Run: `npm test`
Expected: PASS

- [ ] **Step 4: 人工驗收**

Run: `npm run dev`，用一個已封存、已產生報告的任務，以 owner 身分開啟任務頁。確認：

1. 連結開啟狀態下有「開啟」，按下會開新分頁並顯示報告
2. 按「關閉連結」後，「開啟」**消失**，且出現「目前已關閉，連結打不開」
3. 按「重新開啟」後，「開啟」回來
4. 手機寬度（DevTools 375px）下網址框獨佔一行，兩顆按鈕在下一行，沒有溢出

- [ ] **Step 5: Commit**

```bash
git add src/pages/TaskPage.vue
git commit -m "Let the owner open the share link without copying it"
```

---

## 全部完成後

- [ ] `npm test` 全綠
- [ ] `npm run build` 通過（含 `check-chunks.mjs`）
- [ ] 對照規格的驗收標準逐條確認：
      `docs/superpowers/specs/2026-08-05-report-page-polish-design.md`
- [ ] 更新 `todo.md`：在「已完成：公開旅費報告」相關段落補記這次的改版與地圖載入優化
