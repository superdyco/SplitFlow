# 網頁版視覺系統改版

日期：2026-09-02

## 目標

網頁版的設計語彙是有想過的——暖灰底配橘色、tabular-nums、色覺障礙的雙重編碼、
iOS Safari 的原生控制項修正，`styles.css` 的註解都寫得很清楚。問題不在沒人想，
在於這套語彙**只有一階**：一種陰影、一種標籤樣式、四個字級、沒有間距網格。
結果是畫面上每個東西的視覺重量都一樣，而需要「比較不重要」的元件只能靠取消
（`box-shadow: none`）來達成。

這份規格重建那套語彙的階層，處理四件事：層次、顏色噪音、排版粗糙、缺少互動回饋。
同時修掉過程中量出來的兩個對比度不合規。

## 範圍

**要做的**

- `styles.css` 的 token 重寫：顏色、字級、間距、圓角、陰影、動態
- 元件規則：卡片三種身分、藥丸的使用時機、按鈕補第四階、文字顏色三階
- `TaskCard` 去掉三顆橘藥丸、動作按鈕改 quiet、hover 浮起
- `TaskListPage` 的「我的總花費」重做成 hero（五種狀態，含部分失敗）
- `loadCosts` 改用 `Promise.allSettled`，算得出來的先顯示，並記錄哪幾趟沒讀到
- 把「哪些算進總計、佔比怎麼切」抽成 `utils` 的純函式並補測試
- 全站元件對齊新 token
- 互動回饋：hover／按下／浮起，以及主動觸發時的金額滾動與佔比條生長

**明確不做的**

- **不動 `flutter_app/`。** `theme.dart` 是照抄 `styles.css` 的 `:root`，改完之後
  兩版顏色會不一致——這是已知且被接受的，之後單獨處理。
- **不改資料形狀與 Firestore 查詢。** `loadCosts` 的錯誤處理會改，但讀的東西、
  讀的次數、寫進資料庫的內容都不變。
- **不改 `myTripCost` 與 `settleExpenses`。** 金額怎麼算不在這次範圍內，
  只改「算不出來的那幾趟怎麼呈現」。
- **不做列表進場動畫與換頁轉場。** 進場動畫綁在 render 上會讓資料一更新就整排重跳；
  換頁轉場會讓每次導航感覺變慢。
- **不做深色模式。** 另一個等級的工作，而且要先有這套 token 才做得起來。
- **不重構大檔案。** `ReportPage.vue` 與 `ExpenseFormPage.vue` 的 scoped style
  很長，但這次只對齊 token，不拆檔。

## 一、設計 token

### 1.1 灰階：整條下移一階

現在三階灰有兩階讀不清楚。做法不是加新顏色，是整條往下移——舊的 `muted` 變成新的
`soft`，`soft` 的舊值退役。階數與色相都不變。

| token | 舊值 | 新值 | 對頁面底色 `#f2f0ec` | 用途 |
|---|---|---|---|---|
| `--color-ink` | `#1a1613` | 不動 | 15.8:1 | 主要文字、金額 |
| `--color-muted` | `#8a8078` | `#6f665e` | 4.9:1 | **所有次要文字**，含 `.tiny` |
| `--color-soft` | `#a39a90` | `#8a8078` | 3.4:1 | 圖示、邊界、placeholder，以及停用中的控制項。**不放讀得到的文字** |

`#a39a90` 對頁面底色只有 2.4:1，而 `.tiny`（日期、成員數、支出數）正是用它印的。

新的 `soft` 是 3.4:1，過不了文字要求的 4.5:1，但過得了非文字 UI 元件的 3:1。
所以規則必須寫死成「不放讀得到的文字」——否則下一個人又會拿它去印日期。

停用中的控制項是例外：WCAG 1.4.3 明文豁免停用元件的對比要求，而「讀起來就是
按不了」正是停用態該有的樣子。

### 1.2 橘色：按角色拆成三個

主色 `#e8590c` 當按鈕底色時白字只有 3.6:1，當文字色也只有 3.4:1，兩者都過不了 AA。
但整條換深會把品牌色從畫面上抹掉。所以按「這個橘色上面有沒有要讀的東西」分：

| token | 值 | 用途 | 對比 |
|---|---|---|---|
| `--color-primary` | `#e8590c` | 佔比條、tint、`.brand-mark`。**上面不放文字** | 不適用 |
| `--color-primary-dark` | `#c2410c` | 主按鈕底色、所有橘色文字 | 白字 5.2:1／文字 4.6:1 |
| `--color-primary-deep` | `#9a3412` | 主按鈕 hover（新增） | 白字 7.3:1 |
| `--color-primary-soft` | `#fff0e4` | 區域底色。**不給標籤** | 不適用 |

`--color-primary-dark` 沿用既有的名字與值，只是角色從「hover 色」升格成「可以放文字的橘」。
`--color-primary-deep` 是新增的——`#c2410c` 升格之後，原本的 hover 值就空了。

`.brand-mark` 保留亮橘：標誌依 WCAG 免除對比要求，而那是這個橘色唯一純粹是身分的地方。

### 1.2.1 佔比條的明度階

hero 的佔比條需要在同一個色相裡分出三段，不引入新色相：

| token | 值 |
|---|---|
| `--color-primary-b1` | `#e8590c`（即 `--color-primary`） |
| `--color-primary-b2` | `#f0a072` |
| `--color-primary-b3` | `#f7d3bd` |

超過三趟的部分併成「其他」，用 `--color-line-strong`。條子上不放文字，
辨識靠下方的圖例文字（`--color-muted`），所以明度差不需要滿足文字對比。

### 1.3 字級：補上缺的中間階

現在是 30 / 20 / 14 / 12，20 與 14 之間是空的，所以卡片標題只能在「太大」與
「跟內文一樣大」之間二選一。

| token | px | 用途 |
|---|---|---|
| `--text-display` | 34 | hero 金額（新增） |
| `--text-title` | 30 | 頁面標題 `.title` |
| `--text-section` | 20 | 區塊標題 `.section-title` |
| `--text-card` | 17 | 卡片標題（新增） |
| `--text-body` | 14 | 內文 |
| `--text-tiny` | 12 | `.tiny` |

### 1.4 間距：4px 網格

現在的 gap 有 2 / 6 / 8 / 10 / 12 / 16，其中 6 與 10 不在任何網格上。

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-6` 24 · `--space-8` 32

只有六個值可選，就不會再出現「這裡 10 那裡 12」。

另外定義一個不屬於網格的值：

`--space-text` 2 —— **只給同一組文字的上下兩行**（標籤在上、數值在下）。
那不是版面間距，是行距微調，硬拉到 4px 會讓標籤與它描述的數字看起來像兩件事。
現有的四個 `gap: 2px` 全是這個模式（`ReportCard.vue:88`、`SettlementHistory.vue:194`、
`ExpenseFormPage.vue:1088`、`TaskListPage.vue:349`），全部改用這個 token，
其餘地方不得使用。

### 1.5 圓角：八種收成五種

現有 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22。

| token | px | 給誰 | 吸收的舊值 |
|---|---|---|---|
| `--radius-sm` | 10 | 小元件 | 8 |
| `--radius-md` | 14 | 按鈕、輸入框 | 12、16 |
| `--radius-lg` | 18 | 卡片 | 20 |
| `--radius-xl` | 22 | 對話框、空狀態 | — |
| `--radius-pill` | 999 | 藥丸、頭像 | — |

### 1.6 陰影：一個變四個

這是「沒層次」最直接的成因。現在只有 `--shadow-card` 一個又大又軟的陰影，所有卡片
一律套用，結果四個元件必須寫 `box-shadow: none` 把它關掉——`ExpenseRow.vue:99`、
`MemberRow.vue:77`、`SettlementPanel.vue:285`、`TaskCard.vue:105`。

| token | 值 | 給誰 |
|---|---|---|
| `--shadow-flat` | `none` | 列表列、巢狀區塊、封存卡 |
| `--shadow-rest` | `0 1px 2px rgba(26,22,19,.045)` | 一般卡片靜止態 |
| `--shadow-raise` | `0 10px 24px -14px rgba(26,22,19,.42)` | hover 浮起時 |
| `--shadow-pop` | `0 18px 44px -30px rgba(26,22,19,.5)` | 對話框、選單（原 `--shadow-card`） |

改完之後「不浮起」是一個正常的值，不是例外。四個 `box-shadow: none` 全部刪除，
改成宣告身分。

### 1.7 動態

| token | 值 | 用在 |
|---|---|---|
| `--ease` | `cubic-bezier(.2,.7,.3,1)` | 全部 |
| `--dur-press` | 90ms | 按下縮 2.5% |
| `--dur-base` | 140ms | hover 換色、換邊框 |
| `--dur-lift` | 190ms | 卡片浮起 2px＋陰影 |
| `--dur-count` | 620ms | 金額滾動、佔比條生長 |

## 二、元件規則

### 2.1 卡片三種身分

| 類別 | 陰影 | 給誰 |
|---|---|---|
| `.card` | `--shadow-rest` | 獨立的東西：TaskCard、hero、區塊面板 |
| `.card.flat` | `--shadow-flat` | 巢狀在別的卡裡、或列表列 |
| `.card.raised` | `--shadow-pop` | 對話框、選單 |

### 2.2 橘色底：只給容器，不給標籤

`--color-primary-soft` 現在有 8 處當底色，其實混了兩種東西：

- **容器／圖示底**——`ExpenseRow` 的 `.icon`、`AccessDenied`、`ExpenseFormPage`
  的區塊底、`ReportPage` 的區塊底：**保留**
- **標籤**——`TaskCard.vue:193` 的 `.task-meta span` 與 `.role-pill`：**拿掉**

規則：`primary-soft` 是「一塊區域的底」，不是「一個標籤的底」。

### 2.3 藥丸：只有狀態才配藥丸，一張卡最多一顆

- **狀態**（已封存、待上傳、失敗）→ 藥丸。狀態是異常，異常才值得一個色塊。
- **屬性**（4 位成員、27 筆支出、擁有者）→ 純文字，用 `·` 串成一行。

`ExpenseRow` 的 `.repeat` 是動作按鈕不是標籤，保留藥丸形狀，只換 token。

### 2.4 按鈕補第四階

現有 `.btn-primary`（實心）、`.btn`（outline）、`.btn-ghost`（tint）、`.btn-danger`、
`.btn-saved`。中間缺一階：

**`.btn-quiet`（新增）**——純文字、無邊框、`--color-muted`，hover 轉
`--color-primary-ink`。給卡片內的次要動作。

`TaskCard` 的 `.action` 目前是 outline 藥丸，改用它。`.btn-saved` 的綠色雙重編碼
（顏色＋實心/空心愛心）維持不變，那是為色覺障礙做的，沒有理由動。

### 2.5 文字顏色三階

`ink` 主要文字與金額 · `muted` 所有次要文字（含 `.tiny`）· `soft` 圖示、邊界、
placeholder 與停用態，**不放讀得到的文字**。

## 三、TaskListPage 的「我的總花費」

現況是一顆 `.btn-block`「計算我的花費」，按了之後換成一排 `.totals` 數字加一顆
「重新計算」文字鈕。改成一張 hero 卡，五種狀態：

```
┌ 未計算（每次進頁面第一眼）──────────┐
│ 我的總花費                    計算  │
│ 跨旅程加總要把每趟的支出全部載下來， │
│ 點一下才算。                        │
└─────────────────────────────────────┘

┌ 計算中 ─────────────────────────────┐
│ 我的總花費                  計算中… │
│ ▓▓▓▓▓▓▓▓▓▓▓▓                        │  ← 骨架形狀＝結果形狀
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            │
└─────────────────────────────────────┘

┌ 單一幣別 ───────────────────────────┐
│ 我的總花費              重新計算    │
│ TWD 48,320                          │  ← 34px, tabular-nums
│ ████████████░░░░░░░░▒▒▒             │  ← 佔比條
│ ● 東京 65%  ● 大阪 26%  ● 宜蘭 9%   │
└─────────────────────────────────────┘

┌ 多幣別 ─────────────────────────────┐
│ 我的總花費              重新計算    │
│ TWD 48,320                          │
│ ████████████░░░░░░░░▒▒▒             │
│ ● 東京 65%  ● 大阪 26%  ● 宜蘭 9%   │
│ ─────────────────────────────────── │
│ THB 18,900                          │  ← 同樣 34px，不分主次
│ ████████████████░░░░░░░             │
│ ● 曼谷 66%  ● 清邁 34%              │
└─────────────────────────────────────┘
```

四個刻意的安排：

- **未計算狀態不是空框。** 總花費是按需計算的，所以「還沒算」是每次進頁面的第一眼。
  用文字說明為什麼要按，而不是留一塊空白。「計算」是這張卡唯一的橘色。
- **骨架的形狀就是結果的形狀。** 數字進來時不跳版。這一趟的成本是
  「任務數 × 2 趟查詢」，不會太快。
- **一個幣別一塊，各自一條佔比條。** `sumByCurrency` 的註解已經寫明跨幣別不合併——
  匯率是各筆支出記帳當下鎖定的，混成一條等於在說 1 TWD = 1 THB。
- **多幣別的字級一樣大。** `sumByCurrency` 已經照金額排序，順序本身就是層次，
  不需要再用大小暗示一個並不存在的主從關係。

```
┌ 部分失敗 ───────────────────────────┐
│ 我的總花費              重新計算    │
│ TWD 35,740                          │
│ ██████████████████░░░░              │
│ ● 東京 88%  ● 宜蘭 12%              │
│ ─────────────────────────────────── │
│ 有 1 趟旅程沒讀到（大阪 2023），     │  ← --color-danger，在數字旁邊
│ 這個數字少算了那一趟。               │
└─────────────────────────────────────┘
```

佔比條用 §1.2.1 的三階明度，不引入新色相。超過三趟的部分併成「其他」。

## 三之二、部分失敗：算得出來的先給

現在 `TaskListPage.loadCosts` 用 `Promise.all`——任何一趟讀失敗就整個 reject，
`costs` 完全沒填、`costsLoaded` 維持 false。使用者按了「計算」，等了一段
「任務數 × 2 趟查詢」的時間，然後**什麼都沒拿到**，只有一行紅字。

改成 `Promise.allSettled`：成功的進 Map，失敗的記下任務本身。

### 3.2.1 失敗的旅程必須被排除，不能歸零

`totals` 現在是：

```ts
costs.value.get(row.task.id) ?? 0
```

今天沒事，因為全有全無——Map 要嘛全滿要嘛是空的。但換成 `allSettled` 之後，
**`?? 0` 會把讀失敗的那一趟當成「花了零元」算進總額與佔比**。總額少一截、
佔比分母錯掉，而畫面上看起來完全正常。

這是這次改動最容易寫錯的一行：狀態 5 要解決的正是「數字看起來完整但其實不是」，
而同一段程式碼會製造出一模一樣的問題。**失敗的任務要從來源陣列裡濾掉，
不是查 Map 時補 0。**

### 3.2.2 抽成純函式才測得到

沿用這個 repo 既有的規矩——規則放 `utils`，元件只負責畫。新增到
`src/utils/myCost.ts`：

```ts
export interface TripCost {
  taskId: string;
  name: string;
  currency: string;
  amount: number;
}

/** 只把成功的算進總計。失敗的不是 0，是「不知道」。 */
export function totalsOf(ok: TripCost[]): CurrencyAmount[];

/**
 * 某個幣別底下各趟的佔比。照金額排序，第 4 名以後併成「其他」。
 * 全部為 0 時回空陣列 —— 一條分母是 0 的長條沒有意義。
 */
export function sharesOf(
  ok: TripCost[],
  currency: string,
  max?: number
): Array<{ name: string; amount: number; ratio: number }>;
```

`loadCosts` 的職責縮到「發查詢、分成功與失敗兩堆」，怎麼加總、怎麼切佔比
全部走這兩個純函式。

### 3.2.3 要補的測試

新增 `tests/myCost.test.ts` 的案例（該檔已存在，測 `myTripCost` 與 `sumByCurrency`）：

- `totalsOf` 只加總傳進來的項目——失敗的沒傳進來就不會被算到
- `totalsOf` 跨幣別分開列，順序照金額由大到小（沿用 `sumByCurrency` 的既有保證）
- `sharesOf` 的 ratio 加起來是 1
- `sharesOf` 超過 max 趟時，第 max 名以後併成一項「其他」，且併完 ratio 總和仍是 1
- `sharesOf` 在該幣別總額為 0 時回空陣列，不產生除以零
- `sharesOf` 只算指定幣別，其他幣別的項目不影響分母

**這些測試是這次改版唯一測得到的東西**，見 §七。

## 四、TaskCard

- `.role-pill` 與 `.task-meta` 的三顆橘藥丸 → 一行 `--color-muted` 文字，
  `擁有者 · 4 位成員 · 27 筆支出`
- `.archived-pill` 保留藥丸——那是狀態
- `.actions` 的兩顆 outline 藥丸 → `.btn-quiet`，刪除用低飽和紅棕，hover 才轉正紅
- 卡片 hover 浮起 2px，`--shadow-rest` → `--shadow-raise`
- 封存卡改用 `.card.flat`，`box-shadow: none` 刪除
- 「封存卡不給刪除鈕」的規則維持不變

`.stretch::after` 那套 stretched link 不動——它解決的是「`<a>` 不能包互動元素」，
跟視覺無關，而且註解寫得很清楚。

## 五、動態

**做**

- hover 換色 140ms、按下縮 2.5% 90ms、焦點框
- 卡片 hover 浮起 2px + 陰影升階 190ms
- 主按鈕陰影跟著 hover 動

**只在使用者主動觸發時做**

- 金額滾動計數與佔比條生長 620ms，綁在「計算／重新計算」的完成時刻，**不綁 render**。
  第一次「計算」也算主動觸發——兩顆按鈕是同一顆的兩種狀態，行為要一致。

**一律**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

系統設定「減少動態」的人（前庭障礙、暈動症）看到完全靜止的版本。這不是選配。

## 六、會動到的檔案

**核心**

- `src/assets/styles.css` — token 重寫、`.card` 三身分、`.btn-quiet`、reduced-motion
- `src/components/task/TaskCard.vue` — 藥丸→文字、動作→quiet、hover 浮起、flat
- `src/pages/TaskListPage.vue` — hero 四狀態、滾動計數、移除舊的 `.totals` scoped style

**對齊 token**

`ExpenseRow`、`MemberRow`、`SettlementPanel`、`ExpenseDayGroup`、`ReceiptField`、
`ReceiptViewer`、`ReportCard`、`ReportBar`、`CategoryChart`、`SettlementHistory`、
`ConfirmDialog`、`PromptDialog`、`EmptyState`、`ErrorState`、`LoadingState`、
`AccessDenied`、`ProviderButtons`、`PlaceMap`、`AppLayout`、`AuthLayout`、
`TaskPage`、`ExpenseDetailPage`、`CreateTaskPage`、`JoinTaskPage`、`LoginPage`、
`OnboardingPage`、`ProfilePage`、`ExplorePage`、`FavoritesPage`

**最大的兩塊**

`ReportPage.vue`（189 行 scoped style）與 `ExpenseFormPage.vue`（181 行）——
這兩個檔案的樣式量比其他全部加起來還多。只對齊 token，不拆檔。

`ProviderButtons.vue` 的 8 個硬寫 hex 是 Google／Facebook 的品牌色，**不動**。

## 七、驗收

### 7.1 先承認測試套件看不到這次改版

現有 35 個測試沒有一個碰得到 UI：全部 import 自 `@/utils/`（28）、`@/types/`（15）、
`@/services/`（2），沒有 `@vue/test-utils`、沒有 jsdom，沒有任何測試 import `.vue`。
`vite.config.js` 的 `include` 只收 `tests/**/*.test.ts`。

所以「`npm test` 全綠」對這次改版**是零資訊的條件**——它抓不到任何樣式錯誤。
唯一真的被測到的，是 §3.2.3 新增的那幾個純函式案例。其餘全靠型別檢查、
build 與人工走查，這點要說清楚，不要拿一條看起來很安全的假條件自我安慰。

### 7.2 自動

- `npm run check`（`vue-tsc --noEmit`）通過
- `npm run build` 通過，含 `scripts/check-chunks.mjs` 的 chunk 循環相依檢查
- `npm test` 通過，且**新增的 `totalsOf` / `sharesOf` 案例確實存在並會失敗於錯誤實作**
  ——先確認測試會紅，再讓它綠
- 全站搜不到 `#a39a90`
- 全站搜不到 `box-shadow: none`
- 全站搜不到 `gap: 6px` 與 `gap: 10px`；`2px` 只以 `--space-text` 出現在那四處
- `--color-soft` 沒有出現在任何 `color:` 宣告上（只在 `background`、`border`、圖示）
- `TaskListPage` 裡搜不到 `?? 0`（§3.2.1 那個陷阱）

### 7.3 人工

- 走一遍：任務列表、任務頁三個頁籤、支出表單、支出明細、報告頁、個人設定
- hero 五種狀態逐一看過。**部分失敗這個狀態要刻意製造**——暫時讓某個
  `listExpenses` 丟錯，確認總額真的少了那一趟、佔比分母跟著變、而且畫面
  明講是哪一趟沒讀到
- 開系統的「減少動態」再走一遍，確認沒有任何東西在動
