# 支出表單重排：三張卡、固定送出列、抽出地點欄位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ExpenseFormPage.vue` 的 13 個平鋪欄位重分成三張卡、送出鈕固定在畫面底部、地點那一整塊抽成 `PlaceField.vue`，讓「只打名稱與金額就按得到送出」不需要捲動。

**Architecture:** 由下而上，風險遞增：先把唯一測得到的規則（`currentPlace`）抽成純函式並 TDD，再刪死碼，接著抽 `PlaceField.vue`（把母元件縮掉三分之一的狀態，後面重排 template 時要搬的行數才少），然後才重排三張卡，最後做固定送出列 —— 那是唯一會動到頁面骨架、也是唯一在手機上才驗得出來的一項。

**Tech Stack:** Vue 3.5 + TypeScript + Vite + vue-router 4 + Pinia，測試用 vitest（純函式，無 DOM），型別檢查 `vue-tsc --noEmit`。

**Spec:** `docs/superpowers/specs/2026-09-02-expense-form-layout-design.md`

## Global Constraints

- **只動 `src/`。** `flutter_app/` 完全不碰 —— 它是這次的參考來源，不是修改對象。
- **不改任何金額計算、分攤邏輯或送出流程。** `canSubmit`、`evenSplits`、`customSplits`、`finalSplits`、`submit()` 的主體一律照舊。這次只動版面與檔案切分。
- **不重構 `placeService.ts`。** 見 spec §範圍。Flutter 那邊已經把解析與網路拆開了，網頁版沒有 —— **記錄，不做。**
- **不做漸進揭露。** 所有欄位一律展開，新增與編輯行為一致。
- **只有 `ExpenseFormPage.vue` 會被修改，`styles.css` 不動。** 固定送出列的樣式留在它的 `<style scoped>` 裡 —— 全專案只有這一頁有固定送出列，提前共用化只會多一個沒有第二個使用者的類別。
- **每個任務結束時 `npm run check` 必須通過。**
- **中文註解，寫「為什麼」不寫「做了什麼」。** 跟著既有風格。
- **這個 repo 的工作區檔案是 CRLF 行尾。** 用腳本做字串比對取代時，樣板字串的換行對不上檔案裡的 CRLF，比對會靜默失敗（**沒有錯誤訊息，只是沒改到**）。先偵測行尾再組樣板，或直接用編輯工具。
- **測試套件看不到版面。** 只有 Task 1 的純函式測得到，其餘靠 `vue-tsc`、build 與人工走查。不要用「`npm test` 全綠」當作版面改對了的證據。

### 既有型別（全計畫共用，不要重新定義）

```ts
// src/types/expense.ts
export interface ExpensePlace {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}
```

```ts
// src/services/placeService.ts —— 現有簽名，全部照用
export function placesEnabled(): boolean;
export function newSessionToken(): string;
export function recallPlaceBias(taskId: string): LatLng | null;
export function rememberPlaceBias(taskId: string, place: ExpensePlace): void;
export async function autocompletePlaces(
  query: string, sessionToken: string, bias: LatLng | null
): Promise<PlaceSuggestion[]>;
export async function getPlaceDetails(placeId: string, sessionToken: string): Promise<ExpensePlace>;

export interface PlaceSuggestion { placeId: string; primary: string; secondary: string; }
```

```ts
// src/utils/placeBias.ts
export interface LatLng { lat: number; lng: number; }
export function biasFromPlaces(places: (ExpensePlace | null)[]): LatLng | null;
```

`PlaceMap.vue` 的介面：`:markers="MapMarker[]"` 與 `height="180px"`（字串，含單位）。
`MapMarker` 是 `{ id: string; lat: number; lng: number; title: string }`。

### 既有的樣式資源（`styles.css` 已經有，直接用，不要重寫）

- `.seg` / `.seg-item` / `.seg-item.active` —— 上一輪（`2026-09-02-task-page-settlement-summary`）做的分段控制，白底選中。
- `.card` / `.card.flat` / `.card.raised` —— 卡片三身分。
- `.stack`（flex column，`gap: var(--space-4)`）、`.row`、`.field`、`.label`、`.tiny`、`.input`、`.select`、`.btn` 系列。
- 間距 `--space-1/2/3/4/6/8` 與 `--space-text`；圓角 `--radius-sm/md/lg/xl/pill`。

---

## File Structure

**新增**

- `src/utils/placeSearch.ts` — 「這一格現在代表哪個地點」與「要不要送出查詢」。純函式，不 import vue。名字跟 Flutter 的 `domain/place_search.dart` 對齊。
- `tests/placeSearch.test.ts`
- `src/components/expense/PlaceField.vue` — 地點欄位（搜尋、建議、定位、位置偏好、地圖）。

**修改**

- `src/pages/ExpenseFormPage.vue` — 三張卡、固定送出列、`.seg`、匯率壓行、刪死碼、改用 `PlaceField`

**不修改（明確列出，避免有人順手動）**

- `src/assets/styles.css`
- `src/services/placeService.ts`
- `src/components/map/PlaceMap.vue`
- `src/components/expense/ReceiptField.vue`
- `flutter_app/` 任何檔案

---

## Task 1: `placeSearch` 純函式（TDD）

`currentPlace()` 現在藏在元件裡，而**它寫錯的畫面看起來完全正常** —— 會存進一個名字對不上座標的地點（在拉麵店的搜尋結果上把名字改成「晚餐」，座標卻還是拉麵店的）。這是這次唯一測得到、也最值得測的東西。

**Files:**
- Create: `src/utils/placeSearch.ts`
- Create: `tests/placeSearch.test.ts`

**Interfaces:**
- Consumes: `ExpensePlace`（`@/types/expense`）
- Produces:
  - `currentPlace(query: string, selected: ExpensePlace | null): ExpensePlace | null`
  - `shouldSearchPlace(query: string): boolean`

- [x] **Step 1: 寫會失敗的測試**

建立 `tests/placeSearch.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { currentPlace, shouldSearchPlace } from "@/utils/placeSearch";
import type { ExpensePlace } from "@/types/expense";

const ramen: ExpensePlace = {
  name: "一蘭拉麵",
  address: "台北市中山區",
  lat: 25.05,
  lng: 121.52,
  placeId: "abc123"
};

describe("currentPlace", () => {
  it("沒打字就是沒有地點", () => {
    expect(currentPlace("", null)).toBeNull();
    expect(currentPlace("   ", null)).toBeNull();
  });

  it("只有空白也不算 —— 連選過建議都一樣", () => {
    // 選完再全部刪掉只剩空白，那就是把地點清掉了。
    expect(currentPlace("   ", ramen)).toBeNull();
  });

  it("只打了名字沒選建議，座標一律是 null", () => {
    expect(currentPlace("晚餐", null)).toEqual({
      name: "晚餐",
      address: null,
      lat: null,
      lng: null,
      placeId: null
    });
  });

  it("名字跟選過的建議一致，回那一份完整的", () => {
    expect(currentPlace("一蘭拉麵", ramen)).toBe(ramen);
  });

  it("前後空白不影響是否與選過的建議相符", () => {
    // 輸入框裡多一個空白不該讓座標消失。
    expect(currentPlace("  一蘭拉麵  ", ramen)).toBe(ramen);
  });

  it("名字被改過之後，座標要丟掉", () => {
    // 這是最重要的一條。改過的名字已經不是那個地點了 ——
    // 留著座標會存進一個名字對不上位置的地點，而畫面上看起來完全正常。
    expect(currentPlace("晚餐", ramen)).toEqual({
      name: "晚餐",
      address: null,
      lat: null,
      lng: null,
      placeId: null
    });
  });

  it("回傳的名字是 trim 過的", () => {
    expect(currentPlace("  晚餐  ", null)?.name).toBe("晚餐");
  });
});

describe("shouldSearchPlace", () => {
  it("兩個字以上才查", () => {
    expect(shouldSearchPlace("拉麵")).toBe(true);
    expect(shouldSearchPlace("一蘭拉麵")).toBe(true);
  });

  it("太短不查 —— 每打一個字打一次 API 太浪費，一兩個字也搜不出東西", () => {
    expect(shouldSearchPlace("")).toBe(false);
    expect(shouldSearchPlace("拉")).toBe(false);
  });

  it("只有空白不查", () => {
    expect(shouldSearchPlace("  ")).toBe(false);
    expect(shouldSearchPlace(" 拉 ")).toBe(false);
  });
});
```

- [x] **Step 2: 跑測試確認會失敗**

```bash
npm test -- placeSearch
```

Expected: FAIL，訊息是 `Failed to resolve import "@/utils/placeSearch"`。**如果它直接通過，代表測試沒被收進來，先解決那件事。**

- [x] **Step 3: 實作**

建立 `src/utils/placeSearch.ts`：

```ts
import type { ExpensePlace } from "@/types/expense";

/**
 * 地點欄位裡不碰網路、也不碰 DOM 的那半。名字跟 Flutter 的
 * `lib/domain/place_search.dart` 對齊 —— 兩邊必須是同一個東西。
 *
 * 純函式，不 import vue。
 */

/**
 * 這一格現在代表哪個地點。
 *
 * 選過建議就是完整的那一份（含座標），只打了名字就是只有 name 的那一份，
 * 空的就是 null。
 *
 * 名字跟選取的那一份對得起來才算數 —— 選完再改字的話，剩下的就只是文字。
 * 這條不是龜毛：留著座標會存進一個名字對不上位置的地點，
 * 而那種錯誤在畫面上看起來完全正常。
 */
export function currentPlace(query: string, selected: ExpensePlace | null): ExpensePlace | null {
  const text = query.trim();
  if (!text) return null;
  if (selected && selected.name === text) return selected;
  return { name: text, address: null, lat: null, lng: null, placeId: null };
}

/**
 * 太短就不要查 —— 每打一個字打一次 API 太浪費，而一兩個字也搜不出東西。
 */
export function shouldSearchPlace(query: string): boolean {
  return query.trim().length >= 2;
}
```

- [x] **Step 4: 跑測試確認通過**

```bash
npm test -- placeSearch
```

Expected: PASS，10 個案例全綠。

- [x] **Step 5: 全套測試與型別檢查**

```bash
npm test
npm run check
```

Expected: 兩者都通過。既有的 381 個案例不受影響（這一步只新增檔案）。

- [x] **Step 6: Commit**

```bash
git add src/utils/placeSearch.ts tests/placeSearch.test.ts
git commit -m "Make the name-coordinate mismatch a thing a test can catch

currentPlace() 藏在 ExpenseFormPage 裡，是純函式，而且寫錯的畫面看起來
完全正常 —— 在拉麵店的搜尋結果上把名字改成「晚餐」，存進去的會是一個
名字叫晚餐、座標在拉麵店的地點。回頭看那筆支出，圖釘指著錯的地方。

抽出來的名字跟 Flutter 的 domain/place_search.dart 對齊，因為兩邊必須是
同一個東西。shouldSearchPlace 順手一起抽：它現在是元件裡的一個 magic
number（< 2），寫成有名字的規則才看得出那是「一兩個字也搜不出東西」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 刪掉 `queuedNotice` 死程式碼

先做這一步，因為它跟版面無關、風險最低，而且**後面重排 template 時就少一塊要搬的東西**。

`submit()` 成功時是：

```ts
if (outcome === "queued") queuedNotice.value = true;
await router.push(`/tasks/${taskId}`);
```

設完旗標**立刻導走**，元件跟著卸載 —— 那個 `<p v-if="queuedNotice">` 沒有機會渲染。

**Files:**
- Modify: `src/pages/ExpenseFormPage.vue`

- [x] **Step 1: 刪掉 `ref`**

刪掉 script 裡這兩行（含註解）：

```ts
/** 離線排隊時要告訴使用者資料沒有不見，只是還沒送出去。 */
const queuedNotice = ref(false);
```

- [x] **Step 2: 刪掉 template 那一段**

刪掉：

```html
<p v-if="queuedNotice" class="card tiny">
  目前沒有連線，已經先存在這台裝置上，連上網路後會自動同步。
</p>
```

- [x] **Step 3: 改掉 `submit()` 裡設旗標的那一行**

```ts
if (outcome === "queued") queuedNotice.value = true;
await router.push(`/tasks/${taskId}`);
```

改成：

```ts
/*
  離線排隊時應該要告訴使用者「已經存在這台裝置上，連上網會自動同步」——
  那正是最需要安撫的時刻。原本有這段提示，但它壞了：設完旗標立刻導走，
  元件跟著卸載，那個 <p> 沒有機會渲染。

  刪掉壞的實作，把原意留在這裡。修法不只一種（延後導航、在任務頁顯示、
  改用全域提示），每一種的影響範圍都超出這次改版 —— 但下一個人至少
  知道有人想過這件事，不會以為從來沒有。
*/
void outcome;
await router.push(`/tasks/${taskId}`);
```

> **實作時要現場判斷：** `outcome` 這個變數在 `submit()` 裡除了這裡還有沒有別的使用者。如果沒有，`vue-tsc` 會不會抱怨「宣告了沒用」取決於 `tsconfig.json` 的 `noUnusedLocals`。**先跑 `npm run check` 看它到底抱不抱怨**：
> - 不抱怨 → 把 `void outcome;` 也刪掉，只留註解。
> - 抱怨 → 留著 `void outcome;`（那是「刻意不使用」的標準寫法）。
>
> 不要為了消警告去改 `settleWrite` 的呼叫方式 —— `outcome` 的賦值那幾行是送出流程，不在這次範圍。

- [x] **Step 4: 確認搜不到殘留**

```bash
grep -n "queuedNotice" src/pages/ExpenseFormPage.vue
```

Expected: 沒有任何結果。

- [x] **Step 5: 型別檢查**

```bash
npm run check
```

Expected: 通過。

- [x] **Step 6: Commit**

```bash
git add src/pages/ExpenseFormPage.vue
git commit -m "Delete the offline notice that never had a chance to render

submit() 在 outcome 是 queued 時設旗標，下一行就 router.push 走人 ——
元件卸載，那個 v-if 從來沒有渲染過。所以離線存檔時使用者收不到
「已存在這台裝置上，連上網會自動同步」，而那正是最需要安撫的時刻。

刪掉壞的實作，但把原意寫進註解。修法不只一種（延後導航、在任務頁顯示、
改用全域提示），每一種都超出這次改版的範圍；沒有記錄的話，下一個人會
以為從來沒人想過離線要給提示。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 抽出 `PlaceField.vue`

地點那一整塊 —— 搜尋、建議清單、定位、位置偏好、地圖 —— 自成一個完整的東西，而 `flutter_app/lib/ui/place_field.dart` 早就抽出來了，只有網頁版沒抽。

先抽再重排：母元件少掉約三分之一的狀態與一大塊 template，Task 4 要搬的行數才少。

**Files:**
- Create: `src/components/expense/PlaceField.vue`
- Modify: `src/pages/ExpenseFormPage.vue`

**Interfaces:**
- Consumes: `currentPlace` / `shouldSearchPlace`（Task 1）、`placeService` 全部五個匯出、`geolocation`、`biasFromPlaces`、`mapsEnabled`、`PlaceMap`
- Produces: `<PlaceField :task-id="taskId" v-model="place" />`

### 3.0 介面決定與它的兩個陷阱

Flutter 是 `initial` + `onChanged`；Vue 的等價寫法是 `v-model`：

```ts
defineProps<{ taskId: string }>();
const place = defineModel<ExpensePlace | null>();
```

**陷阱一：這是全專案第一次用 `defineModel`。**

```bash
grep -rn "defineModel" src/
```

現在是零筆。Vue 是 3.5.13，`defineModel` 從 3.4 起是穩定 API，可以用。但**如果 `vue-tsc` 在這一步報出跟 `defineModel` 型別推導有關的錯，不要花時間跟它纏鬥** —— 退回等價的 props + emit 寫法：

```ts
const props = defineProps<{ taskId: string; modelValue: ExpensePlace | null }>();
const emit = defineEmits<{ "update:modelValue": [ExpensePlace | null] }>();
```

母元件的 `v-model="place"` 兩種寫法都一樣，不用改。

**陷阱二：不要 `watch` model 值。**

Flutter 版是 `initial` + `onChanged`，**單向**：進來時讀一次，之後只往外送。Vue 的 `v-model` 看起來是雙向的，很容易順手寫成 `watch(place, syncQuery)` —— 那會成環：使用者打字 → emit → 母元件更新 → watch 觸發 → 改 `placeQuery` → 再 emit。

正確做法是**只在 setup 時讀一次初始值**：

```ts
const placeQuery = ref(place.value?.name ?? "");
const selectedPlace = ref<ExpensePlace | null>(place.value);
```

這樣安全，因為母元件的 template 是 `<template v-else>`（`loading` 是 false 才渲染），而 `load()` 與 `applyRepeatSource()` 都在 `loading` 還是 true 時就把地點設好了 —— PlaceField 掛載時 `place` 已經有值。**動 template 結構時不要破壞這個前提**（Task 4 與 Task 5 都不會，但要知道它在那裡）。

- [x] **Step 1: 建立元件**

建立 `src/components/expense/PlaceField.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExpensePlace } from "@/types/expense";
import { currentPlace, shouldSearchPlace } from "@/utils/placeSearch";
import {
  autocompletePlaces,
  getPlaceDetails,
  newSessionToken,
  placesEnabled,
  recallPlaceBias,
  rememberPlaceBias,
  type PlaceSuggestion
} from "@/services/placeService";
import { geolocationAvailable, getCurrentLatLng } from "@/services/geolocation";
import { biasFromPlaces, type LatLng } from "@/utils/placeBias";
import { mapsEnabled } from "@/services/mapsLoader";
import PlaceMap, { type MapMarker } from "@/components/map/PlaceMap.vue";

/** `taskId` 是位置偏好（recallPlaceBias / rememberPlaceBias）需要的。 */
const props = defineProps<{ taskId: string }>();
const place = defineModel<ExpensePlace | null>();

/*
  初始值只讀一次，之後單向往外送 —— 跟 Flutter 版的 initial + onChanged
  是同一個約定。不 watch model：使用者打字會 emit，emit 讓母元件更新，
  更新又觸發 watch 改回 placeQuery，那是一個環。

  只讀一次是安全的，因為母元件在 loading 為 false 之前就把地點設好了
  （load() 與 applyRepeatSource() 都是），這個元件掛載時已經有值。
*/
const placeQuery = ref(place.value?.name ?? "");
const selectedPlace = ref<ExpensePlace | null>(place.value ?? null);

const suggestions = ref<PlaceSuggestion[]>([]);
const placeLoading = ref(false);
const locating = ref(false);
const placeError = ref<string | null>(null);
const placeSearchable = placesEnabled();

/** 按下定位鍵抓到的座標。只用來在地圖上標出「你在這」，不會存進支出裡。 */
const myLocation = ref<LatLng | null>(null);

/**
 * 搜尋的位置偏好。沒有它的話「星巴克」會回傳全世界的分店 ——
 * 人在曼谷卻搜到台北那間。第一筆支出還沒有參考點，就退回原本的全球搜尋。
 *
 * 編輯既有支出時，它自己的座標比 localStorage 裡那個更能代表要找的區域，
 * 所以初始地點優先。
 */
const placeBias = ref<LatLng | null>(
  biasFromPlaces([place.value ?? null]) ?? recallPlaceBias(props.taskId)
);

const mapAvailable = mapsEnabled();

/**
 * 定位鍵的用途就是把「你在這」畫在下面那張地圖上，沒有地圖金鑰就沒有地圖可畫，
 * 按了不會有任何反應 —— 那種按鈕不如不要出現。
 */
const canLocate = mapAvailable && geolocationAvailable();

let placeSession = newSessionToken();
let placeTimer: number | undefined;

/**
 * 地圖上永遠只有一個標記，而且選好的地點優先。
 *
 * 定位只是還沒決定地點時的參考 —— 一旦選了店，地圖要標的就是那家店。
 * 兩個一起畫的話，地圖上兩顆紅點誰是誰看不出來，存進支出的又只有其中一個。
 *
 * 目前位置是「隱藏」不是「清掉」：把地點欄位清空或改字之後，
 * 那個參考點會自己回來，不用再按一次定位。
 * 只打名字沒選建議的地點沒有座標，畫不出來，那時也是回頭標目前位置。
 */
const placeMarkers = computed<MapMarker[]>(() => {
  const picked = selectedPlace.value;
  if (picked && picked.lat !== null && picked.lng !== null) {
    return [{ id: picked.placeId ?? "place", lat: picked.lat, lng: picked.lng, title: picked.name }];
  }
  const here = myLocation.value;
  return here ? [{ id: "me", lat: here.lat, lng: here.lng, title: "你目前的位置" }] : [];
});

/**
 * 這一格的值只有一個真相來源：輸入的字加上選過的那一份建議。
 * 兩者任一改變就往上送 —— 母元件不需要知道這裡面有九個 ref。
 */
watch([placeQuery, selectedPlace], () => {
  place.value = currentPlace(placeQuery.value, selectedPlace.value);
});

function onPlaceInput(value: string) {
  placeQuery.value = value;
  // 一改字就作廢選過的建議：改過的名字已經不是那個地點了，座標必須跟著丟掉。
  selectedPlace.value = null;
  placeError.value = null;
  if (!placeSearchable) return;

  window.clearTimeout(placeTimer);
  if (!shouldSearchPlace(value)) {
    suggestions.value = [];
    return;
  }
  // 每打一個字就打一次 API 太浪費，等使用者停下來再查。
  placeTimer = window.setTimeout(searchPlaces, 350);
}

async function searchPlaces() {
  placeLoading.value = true;
  placeError.value = null;
  try {
    suggestions.value = await autocompletePlaces(placeQuery.value, placeSession, placeBias.value);
  } catch (err) {
    suggestions.value = [];
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

async function pickPlace(suggestion: PlaceSuggestion) {
  placeLoading.value = true;
  placeError.value = null;
  try {
    const detail = await getPlaceDetails(suggestion.placeId, placeSession);
    selectedPlace.value = detail;
    placeQuery.value = detail.name;
    suggestions.value = [];
    // 這個任務接下來的搜尋就以這裡為中心。選到沒有座標的地點時保留原本的偏好。
    rememberPlaceBias(props.taskId, detail);
    placeBias.value = biasFromPlaces([detail]) ?? placeBias.value;
    // 一次 autocomplete + details 算一個 session，選完就換新的。
    placeSession = newSessionToken();
  } catch (err) {
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

/**
 * 定位鍵：抓現在的座標，標在下面那張地圖上。
 *
 * 定位抓到的座標不會存進支出。那顆鍵只回答「我在哪」，不去猜你人在哪家店 ——
 * 它只做兩件事：換掉搜尋的位置偏好，以及在還沒選地點時讓地圖有東西可以顯示。
 *
 * 順帶把偏好換成這裡：人就在這，比上一筆支出的座標更準，
 * 而且這是 autocomplete 請求上的一個欄位，不會多花錢。
 */
async function useCurrentLocation() {
  locating.value = true;
  placeError.value = null;
  try {
    const here = await getCurrentLatLng();
    myLocation.value = here;
    placeBias.value = here;
  } catch (err) {
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    locating.value = false;
  }
}

function clearPlace() {
  window.clearTimeout(placeTimer);
  placeQuery.value = "";
  selectedPlace.value = null;
  suggestions.value = [];
  placeError.value = null;
  // 目前位置不清掉：那是「我在哪」，跟這一格填了什麼地點無關。
}
</script>

<template>
  <div class="field">
    <div class="spread">
      <span class="label">地點（選填）</span>
      <button v-if="placeQuery" type="button" class="link" @click="clearPlace">清除</button>
    </div>
    <div class="place">
      <div class="row">
        <input
          :value="placeQuery"
          class="input grow"
          :placeholder="placeSearchable ? '輸入店名或地址，從清單選一個' : '輸入地點名稱'"
          autocomplete="off"
          @input="onPlaceInput(($event.target as HTMLInputElement).value)"
        />
        <!--
          只有一個圖示，所以 aria-label 是它唯一的名字，不能省。
          title 讓滑鼠停著也看得到說明。
        -->
        <button
          v-if="canLocate"
          type="button"
          class="btn icon-btn"
          :class="{ working: locating }"
          :disabled="locating"
          aria-label="標出我目前的位置"
          title="標出我目前的位置"
          @click="useCurrentLocation"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <path
              d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <ul v-if="suggestions.length" class="suggestions">
        <li v-for="item in suggestions" :key="item.placeId">
          <button type="button" class="suggestion" @click="pickPlace(item)">
            <strong>{{ item.primary }}</strong>
            <span v-if="item.secondary" class="tiny">{{ item.secondary }}</span>
          </button>
        </li>
      </ul>
    </div>
    <span v-if="locating" class="tiny">正在取得目前位置...</span>
    <span v-else-if="placeLoading" class="tiny">搜尋中...</span>
    <span v-else-if="placeError" class="tiny warn">{{ placeError }}</span>
    <span v-else-if="selectedPlace?.address" class="tiny">{{ selectedPlace.address }}</span>
    <span v-else-if="!placeSearchable" class="tiny">
      沒有設定地點服務金鑰，目前只會存你打的名稱，不會有地址與座標。
    </span>
    <!--
      180px。規格本來要壓成 120px，實作後目視覺得太扁而推翻 —— 見
      spec §3.2 與 Task 3 Step 5 的驗證結果。
    -->
    <PlaceMap v-if="mapAvailable && placeMarkers.length" :markers="placeMarkers" height="180px" />
  </div>
</template>

<style scoped>
.grow {
  flex: 1;
  min-width: 0;
}

.row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.place {
  position: relative;
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary-dark);
  font-size: var(--text-tiny);
  font-weight: 700;
}

/* 只有圖示的方形按鈕（定位），高度對齊旁邊的輸入框（.input 是 52px）。 */
.icon-btn {
  flex: none;
  width: 52px;
  min-height: 52px;
  padding: 0;
  color: var(--color-primary-dark);
}

/*
  進行中的回饋：這種按鈕上沒有文字可以改成「定位中...」，只好讓圖示自己動。
  抓 GPS 動輒好幾秒，沒有任何動靜的話會被當成沒反應而一直重按。
*/
.icon-btn.working {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.icon-btn.working svg {
  animation: icon-pulse 1s ease-in-out infinite;
}

@keyframes icon-pulse {
  50% {
    opacity: 0.25;
  }
}

/* 會暈車的人不需要這個提示，顏色的變化已經說明狀態了。 */
@media (prefers-reduced-motion: reduce) {
  .icon-btn.working svg {
    animation: none;
  }
}

.suggestions {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-card);
  box-shadow: var(--shadow-pop);
  max-height: 260px;
  overflow-y: auto;
}

.suggestion {
  display: flex;
  flex-direction: column;
  gap: var(--space-text);
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  text-align: left;
}

.suggestion:hover {
  background: var(--color-primary-soft);
}

.suggestion .tiny {
  line-height: 1.4;
}

.warn {
  color: var(--color-danger);
}
</style>
```

> **注意 `.icon-btn`、`.row`、`.grow`、`.warn`、`.link` 在母元件裡還有別的使用者**（語音輸入鈕用 `.icon-btn`，金額列用 `.row`／`.grow`，金額錯誤用 `.warn`，分攤成員的「全選」用 `.link`）。所以這裡是**複製**不是搬移 —— 母元件那幾條要留著。Step 2 只刪母元件裡「只有地點在用」的那些。

- [x] **Step 2: 母元件接上，刪掉搬走的東西**

在 `ExpenseFormPage.vue`：

**a. 加 import，刪掉不再用到的：**

```ts
import PlaceField from "@/components/expense/PlaceField.vue";
```

刪掉這些 import（**先確認整個檔案裡真的沒有別的使用者再刪**）：

```ts
import {
  autocompletePlaces, getPlaceDetails, newSessionToken, placesEnabled,
  recallPlaceBias, rememberPlaceBias, type PlaceSuggestion
} from "@/services/placeService";
import { geolocationAvailable, getCurrentLatLng } from "@/services/geolocation";
import { mapsEnabled } from "@/services/mapsLoader";
import PlaceMap, { type MapMarker } from "@/components/map/PlaceMap.vue";
```

`biasFromPlaces` 與 `LatLng`（`@/utils/placeBias`）**也刪** —— 唯一的使用者是 `placeBias`，已經搬進子元件了。

**b. 十個 ref／computed／函式換成一個 ref：**

刪掉 `placeQuery`、`selectedPlace`、`suggestions`、`placeLoading`、`locating`、`placeError`、`placeSearchable`、`myLocation`、`placeBias`、`mapAvailable`、`canLocate`、`placeSession`、`placeTimer`、`placeMarkers`，以及 `currentPlace()`、`onPlaceInput()`、`searchPlaces()`、`pickPlace()`、`useCurrentLocation()`、`clearPlace()`。

換成：

```ts
/** 這筆支出的地點。搜尋、定位、地圖全在 PlaceField 裡，這裡只收結果。 */
const place = ref<ExpensePlace | null>(null);
```

**c. 三個賦值點改掉：**

`applyRepeatSource()` 裡：

```ts
selectedPlace.value = fields.place;
placeQuery.value = fields.place?.name ?? "";
```

改成：

```ts
place.value = fields.place;
```

`load()` 裡：

```ts
selectedPlace.value = expense.place;
placeQuery.value = expense.place?.name ?? "";
// 編輯這筆支出時，它自己的座標比 localStorage 裡那個更能代表要找的區域。
placeBias.value = biasFromPlaces([expense.place]) ?? placeBias.value;
```

改成：

```ts
place.value = expense.place;
// 「編輯時用這筆支出的座標當搜尋偏好」搬進 PlaceField 了 ——
// 它從初始值自己推得出來，母元件不必知道有位置偏好這件事。
```

`submit()` 的 `input` 物件裡：

```ts
place: currentPlace(),
```

改成：

```ts
place: place.value,
```

**d. template 那一整塊 `<div class="field">`（地點）換成一行：**

```html
<PlaceField :task-id="taskId" v-model="place" />
```

**e. `<style scoped>` 刪掉只有地點在用的：** `.place`、`.suggestions`、`.suggestion`、`.suggestion .tiny`。

`.icon-btn`（含 `.working`、`@keyframes icon-pulse`、reduced-motion 那段）**留著** —— 語音輸入鈕還在用。
`.link`、`.warn`、`.row`、`.grow` 也留著，見 Step 1 的注意事項。

- [x] **Step 3: 確認沒有殘留引用**

```bash
grep -nE "placeQuery|selectedPlace|placeBias|placeMarkers|placeSession|placeTimer|currentPlace|pickPlace|searchPlaces|useCurrentLocation|clearPlace|mapAvailable|canLocate|placeSearchable" src/pages/ExpenseFormPage.vue
```

Expected: 沒有任何結果。

```bash
grep -nE "\.suggestions|\.suggestion|\.place \{" src/pages/ExpenseFormPage.vue
```

Expected: 沒有任何結果。

- [x] **Step 4: 型別檢查與 build**

```bash
npm run check
npm run build
```

Expected: 都通過，含 `check-chunks.mjs`。

> 多一個元件不影響 chunk 切分（`manualChunks` 分的是 `node_modules`，不是 `src/`），但還是要跑 —— build 是唯一會抓到「template 裡引用了已刪除的變數」的地方，`vue-tsc --noEmit` 對 template 的覆蓋不完整。

- [x] **Step 5: 手動驗證地點**

`npm run dev`，開一筆支出：

1. 地點打「拉」→ 不該有請求（少於兩個字）
2. 打「拉麵」→ 停 350ms 後出現建議
3. 選一個 → 名稱帶入、地址顯示在下面、地圖出現圖釘
4. **把名字改掉**（例如改成「晚餐」）→ 圖釘應該消失或退回目前位置
5. 存檔，回去編輯那筆 → 名稱是「晚餐」、**沒有圖釘**
6. 按定位鍵 → 地圖標出目前位置，**地點欄位的字不變**
7. 存檔，回去編輯 → 地點是你打的字，定位的座標**沒有**被存進去
8. 「清除」→ 欄位清空，目前位置的標記回來

- [x] **Step 6: Commit**

```bash
git add src/components/expense/PlaceField.vue src/pages/ExpenseFormPage.vue
git commit -m "Pull the place field out of the biggest file in the project

搜尋、建議清單、定位、位置偏好、地圖自成一個完整的東西，而
flutter_app/lib/ui/place_field.dart 早就抽出來了，只有網頁版沒抽。母元件
少掉十個 ref 與四個服務的 import。

介面用 v-model 而不是 props + emit，那是 Flutter 那邊 initial + onChanged
的 Vue 等價寫法。但內部只在 setup 時讀一次初始值、之後單向往外送 ——
watch model 會成環：打字 emit、母元件更新、watch 改回輸入框、再 emit。
只讀一次是安全的，因為母元件在 loading 還是 true 時就把地點設好了。

「編輯時用這筆支出的座標當搜尋偏好」跟著搬進去：子元件從初始值自己推得
出來，母元件不必知道有位置偏好這件事。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 三張卡、`.seg`、匯率壓行

13 個欄位重新分成三張卡，**依「你會不會動它」而不是依主題**。

**Files:**
- Modify: `src/pages/ExpenseFormPage.vue`

### 4.0 目標結構

```
卡 1（主卡，沒有小標）
  分類 chips
  支出名稱（含語音）
  金額 ＋ 幣別（同一列）
  匯率（跨幣別時）

卡 2「這趟的細節」
  日期 ＋ 時間（同一列）
  PlaceField
  ReceiptField
  備註

卡 3「怎麼分」
  誰先付
  分攤方式（.seg）
  分攤成員／每人金額
```

三個刻意的安排，**改的時候不要「順手優化」掉**：

- **匯率留在卡 1。** 它是「多少錢」的一部分，搬去別張卡會讓人找不到。
- **分類 chips 留在最上面。** 它不是必填，但它是六選一的 chips、高度只有一行多、而且是最常改的。放在名稱上面，手指從分類滑到名稱是連續動作。
- **「誰先付」放卡 3 不放卡 1。** 它預設是自己，概念上屬於「這筆錢怎麼算」。放卡 1 會把主卡撐大，換不到相應的價值。

**不要改成依主題分的四張卡。** 那樣邏輯比較自明，但卡片的 padding 與間距是有成本的，總高度會比現在更長 —— 而縮短捲動距離正是這次的目標。

- [x] **Step 1: 卡 1 —— 現有那張卡收到金額為止**

現在的 template 是一張 `<div class="card stack">` 包住全部。把它的結尾 `</div>` 移到「金額 ＋ 幣別」那一列之後。

順序：分類 chips → 支出名稱 → 金額列 → （Step 3 之後的匯率區塊）。

**日期那一整塊往下搬**（它現在夾在金額與匯率之間）。

- [x] **Step 2: 開卡 2 與卡 3**

卡 1 的 `</div>` 之後接：

```html
<div class="card stack">
  <h2 class="card-head">這趟的細節</h2>
  <!-- 日期 ＋ 時間那一整個 .field -->
  <!-- <PlaceField ... /> -->
  <!-- <ReceiptField ... /> -->
  <!-- 備註那個 label.field -->
</div>

<div class="card stack">
  <h2 class="card-head">怎麼分</h2>
  <!-- 誰先付 -->
  <!-- 分攤方式（Step 4 改成 .seg） -->
  <!-- 分攤成員 / 每人金額 兩個分支 -->
</div>
```

小標的樣式加進 `<style scoped>`：

```css
/*
  卡片的小標。用 --text-card 而不是 --text-section：這是卡片標題不是頁面
  區段，而 --text-card 正是為了「太大」與「跟內文一樣」之間那一格才加的。
*/
.card-head {
  margin: 0;
  font-size: var(--text-card);
  font-weight: 800;
}
```

> **卡 1 沒有小標，這是刻意的。** 它是主角，不需要一個標題來宣告自己是主角。

- [x] **Step 3: 匯率區塊壓成兩行**

現在是輸入框 ＋ 換算後金額 ＋ 格式錯誤三個區塊。把換算後金額壓成輸入框下面一行灰字。

原本：

```html
<span v-if="rateFormatError" class="tiny warn">{{ rateFormatError }}</span>
<span v-else-if="rateError" class="tiny warn">{{ rateError }}</span>
<span v-else-if="rateUpdatedAt" class="tiny">參考匯率更新於 {{ rateUpdatedAt }}，可以自己改成實際成交匯率。</span>
<span v-if="baseAmount !== null" class="tiny">
  換算後約 {{ baseCurrency }} {{ formatAmount(baseAmount, baseCurrency) }}，記帳後就固定不再變動。
</span>
```

改成：

```html
<!--
  格式錯誤維持獨立一行 —— 那是錯誤，該有重量。
  查詢失敗也是。三者互斥，所以最多只會佔一行。
-->
<span v-if="rateFormatError" class="tiny warn">{{ rateFormatError }}</span>
<span v-else-if="rateError" class="tiny warn">{{ rateError }}</span>
<span v-else-if="baseAmount !== null" class="tiny">
  ≈ {{ baseCurrency }} {{ formatAmount(baseAmount, baseCurrency) }}
</span>
```

> **這一步刪掉了兩句說明**（「記帳後就固定不再變動」與「參考匯率更新於…可以自己改」）。那是刻意的：三塊壓成兩行的代價就是這兩句。`rateUpdatedAt` 這個 ref 如果因此沒有任何使用者了，**一併刪掉**（`loadRate()` 裡那行賦值也刪）—— 留著一個沒人讀的 ref 比刪掉更難懂。**先 grep 確認**：
> ```bash
> grep -n "rateUpdatedAt" src/pages/ExpenseFormPage.vue
> ```

- [x] **Step 4: 「分攤方式」換成 `.seg`**

現在用的是任務頁最上層那個導覽元件（`.tabs.two`，選中態是墨黑實心）—— 那是頁面層級的視覺重量，用在表單裡的一個二選一上太搶。

```html
<div class="tabs two">
  <button class="tab" :class="{ active: splitMode === 'even' }" @click="setSplitMode('even')">均分</button>
  <button class="tab" :class="{ active: splitMode === 'custom' }" @click="setSplitMode('custom')">
    自訂金額
  </button>
</div>
```

改成：

```html
<!--
  用 .seg 不用 .tabs：.tabs 是任務頁最上層的頁籤，墨黑實心，那是頁面層級的
  重量。這裡只是表單裡的一個二選一。.seg 就是為次層級切換做的。
-->
<div class="seg">
  <button type="button" class="seg-item" :class="{ active: splitMode === 'even' }" @click="setSplitMode('even')">
    均分
  </button>
  <button type="button" class="seg-item" :class="{ active: splitMode === 'custom' }" @click="setSplitMode('custom')">
    自訂金額
  </button>
</div>
```

> 兩顆按鈕原本都沒有 `type="button"`。這一頁沒有 `<form>` 包著，所以現況不會誤送出 —— 但補上是對的，而且跟這一頁其他按鈕一致。
>
> `.seg` 是 `display: inline-flex; flex: none`，所以它**不會撐滿整行**，跟原本 `.tabs.two` 佔滿一整列不一樣。那是預期的：分段控制本來就該只有內容那麼寬。

- [x] **Step 5: 驗證**

```bash
grep -n 'class="tabs' src/pages/ExpenseFormPage.vue
```

Expected: 沒有任何結果。

```bash
grep -c 'class="card stack"' src/pages/ExpenseFormPage.vue
```

Expected: 3。

- [x] **Step 6: 型別檢查與 build**

```bash
npm run check
npm run build
```

Expected: 都通過。

- [x] **Step 7: 目視走一遍**

`npm run dev`：

- 三張卡，卡 1 沒有小標，卡 2、卡 3 有
- 分類、名稱、金額、幣別都在卡 1
- 選一個外幣 → 匯率欄位出現**在卡 1 裡**，換算後金額是輸入框下面一行灰字（`≈ TWD 672`）
- 「分攤方式」是白底選中的分段控制，不是墨黑實心
- 卡 3 的順序是誰先付 → 分攤方式 → 分攤成員

- [x] **Step 8: Commit**

```bash
git add src/pages/ExpenseFormPage.vue
git commit -m "Give the two required fields a card of their own

13 個欄位平鋪在同一張卡裡，而 canSubmit 只要求兩個 —— 名稱與金額。
其餘九個全都有能用的預設值。每個東西的視覺重量都一樣，所以真正重要的
那兩個沒有重量。

分成三張卡，依「你會不會動它」而不是依主題。依主題分邏輯比較自明，
但要四張卡，而卡片的 padding 是有成本的 —— 總高度會比現在更長，
那是反方向。

匯率留在卡 1：它是「多少錢」的一部分。誰先付放卡 3：它預設是自己，
概念上屬於「這筆錢怎麼算」，放卡 1 會把主卡撐大而換不到價值。

分攤方式從 .tabs 換成 .seg。.tabs 是任務頁最上層的頁籤，墨黑實心，
那是頁面層級的重量，用在表單裡的二選一上太搶。

匯率的三塊壓成兩行，代價是刪掉「記帳後就固定不再變動」與「參考匯率
更新於」兩句說明。換算後金額變成輸入框下面的一行 ≈ 灰字。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 固定送出列

最後做，因為它是唯一動到頁面骨架、也是唯一在手機上才驗得出來的一項。

### 5.0 兩條不能妥協的規則

**只有送出鈕與錯誤訊息進固定列。**

錯誤必須跟著進去：送出失敗時 `error` 會被設值，但如果它印在捲動流的底部而使用者停在上面，他會按了送出、什麼都沒發生、也不知道為什麼。

**刪除與取消留在捲動流裡。**

`93be088`（*Stop putting the destructive button under the thumb*）動的正是這個檔案，理由寫得很清楚：手機上系統對話框「OK 落在哪不是我們能決定的，而它傾向落在拇指下」。固定在螢幕底部的那一條**就是拇指的定位點**。把「刪除支出」放進去，等於把這個檔案自己修掉的問題原樣放回來。

附加好處：刪除需要刻意捲下去才找得到 —— 那正是它應得的摩擦。

取消也留在下面：它是「放棄剛打的東西」，而返回鍵本來就能離開，不需要在拇指位置常駐一顆。

### 5.1 為什麼是 `sticky` 不是 `fixed`

這一頁到處是文字輸入框，而 iOS Safari 的虛擬鍵盤跳出來時，`fixed` 元素的行為是出了名的不可靠 —— 它可能被鍵盤蓋住、也可能浮在鍵盤上方擋住正在打字的欄位。`sticky` 黏在捲動容器內，跟著內容走，鍵盤怎麼動都不會錯位。

跟 `styles.css` 裡那幾條 iOS Safari 的原生控制項修正是同一類問題：桌面瀏覽器上兩種寫法看起來一樣，手機上只有一種能用。

**捲動容器是 document。** `AppLayout` 的 `.page` 只有 `min-height: 100vh`，沒有 `overflow`，所以 `sticky` 的參考是 viewport —— 這正是我們要的。`.stack` 是 flex column，`sticky` 在 flex item 上是有效的。

- [x] **Step 1: template 收尾改寫**

現在是：

```html
<ErrorState :message="error" />

<button class="btn btn-primary btn-block" :disabled="saving || !canSubmit" @click="submit">
  {{ saving ? "儲存中..." : isEdit ? "儲存變更" : "新增支出" }}
</button>
<button
  v-if="isEdit"
  class="btn btn-danger btn-block"
  :disabled="removing"
  @click="confirmingRemove = true"
>
  {{ removing ? "刪除中..." : "刪除支出" }}
</button>
<button class="btn btn-block" @click="router.push(`/tasks/${taskId}`)">取消</button>
```

改成：

```html
<!--
  刪除與取消留在捲動流裡，不進固定列。93be088 動的正是這個檔案：
  手機上系統對話框的 OK 落在哪不是我們能決定的，而它傾向落在拇指下 ——
  螢幕底部那一條就是拇指的定位點，不可逆的操作不該常駐在那裡。

  順帶：刪除需要刻意捲下去才找得到，那正是它應得的摩擦。
-->
<button
  v-if="isEdit"
  class="btn btn-danger btn-block"
  :disabled="removing"
  @click="confirmingRemove = true"
>
  {{ removing ? "刪除中..." : "刪除支出" }}
</button>
<button class="btn btn-block" @click="router.push(`/tasks/${taskId}`)">取消</button>

<!--
  送出鈕固定在畫面底部，錯誤訊息跟著進去 —— 不然送出失敗時，使用者停在
  表單上方，訊息印在捲動流的底部，他會按了送出、什麼都沒發生、也不知道
  為什麼。

  用 sticky 不用 fixed：這一頁到處是文字輸入框，而 iOS Safari 的虛擬鍵盤
  跳出來時 fixed 元素的行為不可靠 —— 可能被鍵盤蓋住、也可能浮在鍵盤上方
  擋住正在打字的欄位。sticky 黏在捲動容器內，跟著內容走。
-->
<div class="submit-bar">
  <ErrorState :message="error" />
  <button class="btn btn-primary btn-block" :disabled="saving || !canSubmit" @click="submit">
    {{ saving ? "儲存中..." : isEdit ? "儲存變更" : "新增支出" }}
  </button>
</div>
```

> **順序變了：送出列現在是 `.stack` 的最後一個孩子**，刪除與取消排在它前面。這是 `sticky bottom` 能運作的前提 —— 它必須在正常流的最後，才會在「還沒捲到它」的時候被拉到 viewport 底部。

- [x] **Step 2: 樣式**

加進 `<style scoped>`：

```css
/*
  固定送出列。sticky 而不是 fixed 的理由見 template 的註解。

  bottom 是負的 --space-6：.page 有 24px 的 padding，sticky 貼在 viewport
  底部時那 24px 會露出頁面背景，看起來像卡在半空中。往下拉滿讓它真的貼底，
  再用自己的 padding 把按鈕推回原位。

  背景不能透明 —— 下面的欄位會直接穿過去。
*/
.submit-bar {
  position: sticky;
  bottom: calc(var(--space-6) * -1);
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 calc(var(--space-6) * -1);
  padding: var(--space-3) var(--space-6) var(--space-6);
  background: var(--color-bg);
}
```

> **`z-index: 4` 是刻意比 `PlaceField` 的 `.suggestions`（`z-index: 5`）低的。** 建議清單是使用者正在互動的東西，它蓋過送出列是對的；反過來的話，地點在卡 2 底部時建議清單會被送出列切掉。
>
> **`margin` 的負值要跟 `.page` 的 padding 一致（`--space-6`）。** 如果之後 `.page` 的 padding 改了，這裡會露餡 —— 但那是 `styles.css` 的事，這次不動它。

- [x] **Step 3: 底部留白**

最後一個欄位會被固定列蓋住，頁面底部要補足夠的空白。

> **這裡有個陷阱：** `.stack` 是全域類別，而這一頁的 template 裡**有五個 `.stack`**（最外層一個、三張卡各一個、`custom-list` 一個）。`<style scoped>` 裡寫 `.stack` 會全部命中，卡片內部也被加上留白，那是錯的。
>
> **正確做法**：給最外層那個 `<div class="stack">` 加一個自己的 class：
>
> ```html
> <div class="stack form-page">
> ```
>
> ```css
> /*
>   固定列會蓋住捲動流的最後一段，所以頁面底部要補足夠的空白 ——
>   不然「取消」按鈕永遠有一半藏在送出鈕下面。
> */
> .form-page {
>   padding-bottom: var(--space-8);
> }
> ```
>
> **不要偷懶用 `.stack`。**

- [x] **Step 4: 記錄 `ReceiptField` 的文案過時**

`ReceiptField.vue` 第 105 行左右有一句：

> 還沒儲存。要按**下面**的「{{ submitLabel }}」，這張照片才會上傳。

送出鈕不再「在下面」了 —— 它現在固定在畫面底部，隨時看得到。

**但 Global Constraints 說 `ReceiptField.vue` 不修改。** 這是計畫層級的衝突，處理方式：

- **這次不改 `ReceiptField.vue`。** 「下面」在固定列的情境下不算錯得離譜（它確實在畫面下方），而改動一個共用元件的文案需要看它的其他使用者。
- **在 `ExpenseFormPage.vue` 傳 `submit-label` 的那一行上方加註解記錄這件事**：

```html
<!--
  ReceiptField 的提示寫「要按下面的『新增支出』」。送出鈕現在固定在畫面
  底部而不是捲動流的下面 —— 那句話還算對（它就在下方），但措辭是為了
  舊版面寫的。之後如果有第二個使用者，那句文案該重寫。
-->
```

- [x] **Step 5: 型別檢查與 build**

```bash
npm run check
npm run build
```

Expected: 都通過。

- [x] **Step 6: 手動驗證（必須用手機或裝置模擬）**

`npm run dev`，用瀏覽器的裝置模擬（或真的手機）開一筆新支出：

1. **不捲動就能送出**：只打名稱與金額，送出鈕就在畫面底部，按得到
2. **捲動過程中送出鈕一直看得到**
3. **最後一個欄位不會被蓋住**：捲到最底，「取消」按鈕完整可見
4. **建議清單不會被切掉**：地點打字，建議清單如果延伸到送出列的位置，它要蓋在上面
5. **送出失敗時錯誤在固定列裡**：斷網後按送出，錯誤訊息出現在按鈕上方、不需要捲下去找
6. **編輯模式下刪除鈕要捲到底才看得到**，不在固定列裡
7. **iOS Safari（如果拿得到裝置）**：點一個文字欄位叫出鍵盤，送出列不該蓋住正在打字的欄位、也不該消失

> 第 7 項如果沒有 iOS 裝置就跳過，但**要在 commit 訊息裡說沒驗過**。選 sticky 的整個理由就是那個情境，宣稱驗過而其實沒驗，比誠實說沒驗更糟。

- [x] **Step 7: Commit**

```bash
git add src/pages/ExpenseFormPage.vue
git commit -m "Put the submit button where the thumb already is

記帳常常是在餐廳裡站著單手做的，而送出鈕在十一個區塊之後。固定在畫面
底部，錯誤訊息跟著進去 —— 不然按了送出、沒反應、也不知道為什麼。

sticky 不是 fixed：這一頁到處是文字輸入框，iOS Safari 的虛擬鍵盤跳出來
時 fixed 元素可能被鍵盤蓋住、也可能浮在鍵盤上方擋住正在打字的欄位。
桌面上兩種寫法看起來一樣，手機上只有一種能用。

刪除與取消留在捲動流裡。93be088 動的正是這個檔案，理由是螢幕底部那一條
就是拇指的定位點，不可逆的操作不該常駐在那裡 —— 把刪除放進固定列等於
把這個檔案自己修掉的問題原樣放回來。附帶好處是刪除要刻意捲下去才找得到。

z-index 比地點建議清單低：使用者正在互動的東西該蓋過送出列。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 驗收

**Files:** 可能修改 `src/pages/ExpenseFormPage.vue`、`src/components/expense/PlaceField.vue`

- [ ] **Step 1: 自動檢查**

```bash
npm run check
npm run build
npm test
```

Expected: 三個都通過。測試數應該是 381 + 10 = 391。

- [ ] **Step 2: 掃描**

```bash
grep -n "queuedNotice" src/pages/ExpenseFormPage.vue          # 預期：無
grep -n 'class="tabs' src/pages/ExpenseFormPage.vue           # 預期：無
grep -n "120px" src/components/expense/PlaceField.vue         # 預期：無（維持 180px，見 spec §3.2）
grep -c 'class="card stack"' src/pages/ExpenseFormPage.vue    # 預期：3
wc -l src/pages/ExpenseFormPage.vue                           # 預期：明顯低於 1104
```

> 行數沒有硬性目標。抽掉地點那一塊（script 約 90 行、template 約 55 行、style 約 60 行）大概會少 200 行上下，但三張卡與固定送出列又加回一些。**如果它還在 1000 行以上，回去看是不是有東西沒刪乾淨。**

- [ ] **Step 3: 確認測試會失敗於錯誤實作**

驗收裡最容易造假的一項。把 `currentPlace` 的第三行暫時改成：

```ts
if (selected) return selected;   // 故意拿掉 name 的比對
```

```bash
npm test -- placeSearch
```

Expected: **「名字被改過之後，座標要丟掉」那個案例要紅。** 如果它還是綠的，測試沒測到該測的東西，回 Task 1 修測試。

**改回來，再跑一次確認綠。**

- [ ] **Step 4: 走查 —— 新增一筆支出**

- 只打名稱與金額，**不捲動**就能按到送出
- 送出後回到任務頁，那筆支出的金額、分類、日期都對

- [ ] **Step 5: 走查 —— 地點的兩條契約**

- 打字有建議、選一個會帶座標
- **改掉名字之後座標要消失**：改完存檔，回去看那筆支出應該沒有地圖圖釘
- **定位鈕抓到的位置不會被存成這筆支出的地點**

- [ ] **Step 6: 走查 —— 編輯一筆支出**

- 所有欄位帶入正確（含地點名稱與圖釘）
- **刪除鈕要捲到底才看得到**，不在固定列裡
- 改一個欄位存檔，其餘欄位沒有被改掉

- [ ] **Step 7: 走查 —— 跨幣別與自訂分攤**

- 選外幣 → 匯率欄位出現在卡 1，換算後金額是輸入框下面一行 `≈` 灰字
- 匯率打成 `1.2.3` → 格式錯誤獨立一行、紅色
- 切到「自訂金額」→ 分段控制是白底選中；均分的結果有帶進去；差額不為零時送出鈕是灰的

- [ ] **Step 8: 走查 —— 「再記一筆」**

從支出列表按「再記一筆」進來，分類／幣別／付款人／分攤設定都有帶入，**地點也要帶入**（那是 `applyRepeatSource` 改過的地方）。

- [ ] **Step 9: 減少動態**

系統設定打開「減少動態」，定位鍵按下去時圖示不該閃爍，但顏色仍要變。

- [ ] **Step 10: Commit（若有修正）**

若前面步驟發現並修正了東西，各自 commit；沒有的話這一步跳過。

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §一 三張卡 | Task 4 Step 1-2 |
| §一 三個刻意的安排 | Task 4 §4.0 的「不要順手優化掉」 |
| §一 為什麼不依主題分 | Task 4 §4.0 |
| §二 2.1 只有送出鈕進固定列 | Task 5 Step 1-3 |
| §二 2.1 sticky 不是 fixed | Task 5 §5.1 + Step 2 |
| §二 2.2 刪除與取消留在捲動流 | Task 5 §5.0 + Step 1 |
| §三 3.1 分攤方式換 `.seg` | Task 4 Step 4 |
| §三 3.2 地圖高度 | Task 3 Step 1 —— **實作後推翻，維持 180px**，spec 已更新 |
| §三 3.3 匯率壓成兩行 | Task 4 Step 3 |
| §三 3.4 刪 `queuedNotice`（含記下原意） | Task 2 |
| §四 4.1 介面 | Task 3 §3.0 |
| §四 4.2 搬進去的東西 | Task 3 Step 1-2 |
| §四 4.3 兩條行為契約寫進註解 | Task 3 Step 1（`useCurrentLocation` 與 `onPlaceInput` 的註解） |
| §五 `currentPlace` 抽成純函式 | Task 1 |
| §五 5.1 六條測試 | Task 1 Step 1（拆成 10 個案例） |
| §六 會動到的檔案 | File Structure |
| §七 7.1 自動 | Task 6 Step 1、Step 3 |
| §七 7.2 掃描 | Task 6 Step 2 |
| §七 7.3 人工 | Task 6 Step 4-9 |

**明確不做的五項**（spec §範圍）全部寫進 Global Constraints：不做漸進揭露、不重構 `placeService.ts`、不改金額計算與送出流程、不動 `flutter_app/`、不修匯率欄位出現造成的版面位移。

沒有未涵蓋的章節。

**已知的計畫層級風險：**

1. **`defineModel` 是全專案第一次用。** Task 3 §3.0 給了退路（props + emit），但實作時要真的跑一次 `npm run check` 才知道需不需要退。不要在型別錯誤上纏鬥超過一輪。

2. **Task 3 Step 2 的「刪掉不再用到的 import」需要現場 grep。** 計畫列出了預期要刪的清單，但 `.icon-btn`、`.row`、`.grow`、`.warn`、`.link` 這幾條樣式在母元件裡**還有別的使用者**（語音鈕、金額列、金額錯誤、分攤成員的全選）。那一步是複製不是搬移 —— 照著清單無腦刪會弄壞語音輸入鈕。

3. **Task 5 Step 3 的 `.stack` 是個陷阱。** 這一頁有五個 `.stack`，scoped 樣式會全部命中。計畫給了正確做法（加一個 `.form-page` class），但那是實作時最容易偷懶的一步。

4. **`sticky` 的負 margin 綁死了 `.page` 的 padding 值。** 兩者不一致的話固定列左右會露出頁面背景。這次不動 `styles.css`，所以現在是對的；但那是一個沒有被任何檢查保護的耦合。**接受它** —— 唯一的替代方案是把送出列的樣式搬進 `styles.css`，而那違反「只有這一頁有固定送出列，不提前共用化」。

5. **`ReceiptField` 的「要按下面的送出鈕」文案在新版面下措辭過時。** Task 5 Step 4 決定不改（那是共用元件，要看它的其他使用者），只加註解記錄。如果驗收時覺得那句話明顯不對，**那是一個獨立的改動，不要塞進這次的 commit。**

6. **Task 5 的第 7 項驗證（iOS Safari 鍵盤）大概驗不到。** 選 `sticky` 的整個理由就是那個情境，而那正是最難驗的一項。沒有裝置的話要在 commit 訊息裡誠實說明沒驗過 —— 不要因為桌面看起來正常就宣稱修好了。

7. **Task 4 與 Task 5 動的是同一個 template 的相鄰區域。** 分成兩個 commit 是為了讓「卡片分對了」與「送出列黏對了」能分開驗。Task 4 結束時送出鈕還在捲動流的最底部，那是預期的中間狀態，**不要在 Task 4 就順手把它黏起來。**
