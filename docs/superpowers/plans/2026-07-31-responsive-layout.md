# 單一版面響應式改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `index.html` 從「手機版／桌機版兩棵獨立 markup 樹」合併成一套畫面，在手機與桌面瀏覽器都能完整操作。

**Architecture:** 刪除 `isDesktop` 分支與所有原型鷹架，保留 `isPhone` 那棵樹作為唯一的 markup。版面控制從「JS 依 `vw` state 算 inline style 字串」改為「CSS class ＋ `<helmet>` 內的 `<style>`」。全檔只設一個媒體查詢斷點 960px；其餘畫面靠 `max-width` 與 `auto-fill` grid 自適應，不用斷點。

**Tech Stack:** dc-runtime（`support.js`，自 unpkg 載入 React 18.3.1 ＋ ReactDOM ＋ Babel）、原生 CSS。無建置流程、無套件管理、無測試框架。

## Global Constraints

- 只能有**一個**媒體查詢斷點：`960px`。其餘響應式行為一律靠 `max-width` / `auto-fill` grid 達成。
- **CSS 自訂屬性不能用在 `@media` 條件裡**。`@media (min-width: var(--bp))` 不會報錯，但整段規則會被靜默忽略。斷點數字必須在 `@media` 中寫死為 `960px`。
- 顏色一律走 CSS 變數；唯一例外是**值來自資料**的樣式，必須留在 inline style：成員頭像底色 `AV[name]`、收支正負色 `#0E9F6E`／`#D63939`。
- `class` 屬性可用（`support.js:436` 會轉成 React `className`）。`<helmet>` 內的 `<style>` 無 scoping，`@media` 完全可用（`support.js:1475-1490`）。
- 不接 Firebase、不接真實登入、不接 Google Maps。示範資料 `RATES`／`EXPENSES`／`PLACES`／四位成員維持寫死。
- 不新增畫面、不新增功能、不做深色模式、不把「新增支出」做成 modal。
- 商業邏輯 `totals()` 與 `transfers()` 的演算法不得變動。

## 關於驗證方式（TDD 的調整）

**本專案沒有測試框架，本計畫刻意不引入。** 交付物是一份即將被重寫的設計稿原型，其驗收標準（見 spec「驗收標準」節）本質是「在四個寬度下目視檢查版面與可操作性」。為此裝設 Playwright 或 vitest，成本高於它能保護的東西，且屬於 spec 明列的範圍外。

因此每個 Task 的驗證步驟是**在指定寬度下的具體目視檢查項目**，每項都寫成可判定真偽的敘述（例如「無橫向捲動」而非「看起來正常」）。執行者必須真的開瀏覽器看過再打勾。

**啟動方式**（每個 Task 的驗證步驟都假設它已經在跑）：

```bash
cd "d:\Project\分帳系統"
py -m http.server 8000
```

然後開 `http://localhost:8000/index.html`。需要連網（unpkg CDN ＋ Google Fonts）。

用 DevTools 的 Device Toolbar（F12 → Ctrl+Shift+M）設定寬度。**注意：要看的是真實視窗寬度效果，Device Toolbar 的縮放會影響媒體查詢判定，請確認 zoom 設為 100%。**

---

## File Structure

本次只動兩個檔案：

- `index.html` — 唯一的實作檔。`<helmet><style>` 內是全站 CSS，`<x-dc>` 內是單一 markup 樹，`<script data-dc-script>` 內是 `Component` 邏輯。
- `docs/superpowers/plans/2026-07-31-responsive-layout.md` — 本計畫，執行過程中勾選進度。

`support.js` 是 dc-runtime 產生檔，**任何情況下都不得修改**（檔首第 1 行明示）。

---

## Task 1: 拆除原型鷹架，合併為單一 markup 樹

把兩棵樹砍成一棵，讓七個畫面在所有寬度都能操作。此時桌機還沒最佳化（內容會攤成一長條），這是預期的中間狀態。

**Files:**
- Modify: `index.html`（`<helmet>` 樣式區、`isDesktop` 整段、`isPhone` 外殼、`state`、`componentDidMount`／`componentWillUnmount`、`renderVals()` 版面樣式區）

**Interfaces:**
- Produces: CSS 變數與基礎 class（`.app`／`.screen`／`.pane`／`.pane--wide`），後續所有 Task 都依賴這組命名。
- Produces: `renderVals()` 中保留的資料型 key（`isLogin`…`isAdd`、`onExpenses`／`onMembers`／`onSettle`、`members`、`expenses`、`balances`、`transfers`、`transferCount` 等）維持原名不變。

- [ ] **Step 1: 把 CSS 骨架寫進 `<helmet>`**

取代 `index.html` 第 14–21 行現有的 `<style>` 區塊：

```html
<style>
  :root {
    --ink:#1A1613; --paper:#FBFAF8; --card:#fff;
    --line:#EDE7E0; --line-2:#E2DCD4; --wash:#F5F1EC;
    --muted:#8A8078; --faint:#A39A90;
    --brand:#E8590C; --brand-soft:#FFF0E4;
    --ok:#0E9F6E; --bad:#D63939;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--paper); color:var(--ink);
    font-family:"Noto Sans TC", system-ui, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  a { color:var(--brand); text-decoration:none; }
  a:hover { color:#C2410C; }
  input, select, button, textarea { font-family:inherit; }
  input:focus, select:focus { outline:2px solid var(--brand); outline-offset:1px; }

  .app { min-height:100vh; display:flex; flex-direction:column; }
  .screen { flex:1; display:flex; flex-direction:column; min-height:0; }
  .pane { width:100%; max-width:480px; margin:0 auto; padding:0 20px; }
  .pane--wide { max-width:1200px; }
  .scroll { flex:1; overflow:auto; }
</style>
```

注意 `::-webkit-scrollbar { width:0 }` 已移除——那是為了假手機殼藏捲軸用的，網頁 app 需要真的捲軸。

- [ ] **Step 2: 刪除 `isDesktop` 整段**

刪除第 56–164 行（`<sc-if value="{{ isDesktop }}">` 到對應的 `</sc-if>`）。這段包含假瀏覽器 chrome、左側任務欄、桌機版任務內頁——桌機版任務內頁會在 Task 4 依 spec 重新做出來，舊版不必保留（git 有紀錄）。

- [ ] **Step 3: 刪除導覽側欄與裝置切換器**

刪除第 26–42 行（`<sc-if value="{{ showNav }}">` 的側欄整段）與第 45–54 行（裝置切換器整段）。

- [ ] **Step 4: 拆掉手機外殼，換成 `.app`**

把第 166–168 行的三層包裝：

```html
<sc-if value="{{ isPhone }}" hint-placeholder-val="{{ true }}">
<div style="{{ phoneShellStyle }}">
  <div style="{{ phoneInnerStyle }}">
```

換成單層：

```html
<div class="app">
```

並刪除第 170–176 行的假狀態列、第 499–501 行的假 home indicator。對應的關閉標籤（第 502–505 行）收斂成一個 `</div>`。外層第 24 行的 `<div style="{{ pageStyle }}">` 與第 44 行的 `<div style="{{ stageStyle }}">` 一併刪除，`.app` 直接掛在 `<x-dc>` 底下。

- [ ] **Step 5: 清掉 state 與生命週期**

`state` 中刪除 `device: "auto", vw: 1400,` 兩個欄位。整個 `componentDidMount()` 與 `componentWillUnmount()` 方法刪除（第 551–556 行）。

`go()` 中原本會強制把 `device` 從 `desktop` 切回 `phone`，簡化為：

```js
go = (screen) => () => this.setState({ screen, copied:false });
```

- [ ] **Step 6: 清掉 `renderVals()` 的版面樣式**

刪除以下區域變數：`bare`、`desktopOn`、`winW`、`wide`。

刪除以下回傳 key：`isPhone`、`isDesktop`、`showNav`、`widthLabel`、`pageStyle`、`stageStyle`、`phoneShellStyle`、`phoneInnerStyle`、`desktopWindowStyle`、`dtRailStyle`、`dtBodyStyle`、`dtListStyle`、`dtPanelStyle`、`setPhone`、`setDesktop`、`setAuto`、`autoTabStyle`、`phoneTabStyle`、`desktopTabStyle`、`nav`、`statusColor`、`homeBarColor`，以及區域變數 `navItems`、`dark`。

- [ ] **Step 7: 修掉 `transfers()` 重複呼叫**

原本第 710–711 行呼叫了兩次。改為在 `renderVals()` 上方先算一次：

```js
const tx = this.transfers(net);
```

回傳區改為：

```js
transfers: tx,
transferCount: tx.length,
```

- [ ] **Step 8: 驗證 — 七個畫面在窄寬兩端都走得通**

啟動 `py -m http.server 8000`，開 `http://localhost:8000/index.html`。

在 **390px** 與 **1440px** 兩個寬度各走一次完整流程，逐項確認：

1. 登入頁出現，兩顆登入鍵可點
2. 點 Google 登入 → 進到建暱稱頁，輸入框可改字且左側圓形頭像字母跟著變
3. 點「建立帳號」→ 任務列表出現
4. 點「＋ 建立分帳任務」→ 建立任務頁，幣別下拉可選
5. 點「建立並取得邀請連結」→ 分享頁，點「複製」文字變「已複製」並在約 1.6 秒後變回
6. 點「進入任務」→ 任務內頁，三個頁籤都可切且各自有內容
7. 點「＋ 新增支出」→ 新增支出頁，金額改數字時下方「≈ NT$」跟著變
8. 點「儲存支出」→ 回到任務內頁

同時確認：**沒有任何假手機殼、假狀態列、假瀏覽器邊框、裝置切換鈕、左側 01–07 導覽列殘留**；**390px 下無橫向捲動**。

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "refactor: 合併手機/桌機兩棵 markup 樹為單一版面

刪除 isDesktop 分支、原型鷹架（假手機殼、狀態列、瀏覽器 chrome、
裝置切換器、01-07 導覽列）與 device/vw state。版面改由 CSS class
控制，並加入 CSS 變數骨架。順帶修正 transfers() 被重複呼叫。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: A 類畫面置中限寬

登入、建暱稱、建立任務、邀請連結、新增支出——這五個畫面內容本來就只有一欄，套 `max-width:480px` 置中即可同時服務兩端。**本 Task 不寫任何媒體查詢。**

**Files:**
- Modify: `index.html`（`<helmet><style>`、五個 A 類畫面的 `<sc-if>` 區塊、`renderVals()` 的 `primaryBtn`／`inputStyle`／`labelStyle`）

**Interfaces:**
- Consumes: Task 1 的 `.pane`、`.screen`、`.scroll`。
- Produces: `.field`／`.field__label`／`.input`／`.btn`／`.btn--primary`／`.btn--ghost`／`.btn--back`／`.card`，Task 3–5 會沿用。

- [ ] **Step 1: 加入表單與按鈕 class**

追加到 `<helmet><style>`：

```css
.card { background:var(--card); border:1px solid var(--line); border-radius:20px; }
.field { margin-bottom:18px; }
.field__label { font-size:12px; font-weight:700; color:var(--muted); margin-bottom:9px; }
.input {
  width:100%; height:54px; border:1px solid var(--line); border-radius:16px;
  padding:0 16px; font-size:15px; font-weight:500;
  background:var(--card); color:var(--ink);
}
.btn { border:none; cursor:pointer; font-weight:700; }
.btn--primary {
  width:100%; height:56px; border-radius:18px;
  background:var(--brand); color:#fff; font-size:16px;
}
.btn--ghost {
  width:100%; height:46px; border-radius:14px;
  border:1px solid var(--line); background:var(--card);
  color:var(--ink); font-size:13px;
}
.btn--back {
  width:38px; height:38px; border-radius:50%;
  border:1px solid var(--line); background:var(--card);
  font-size:16px; color:var(--ink); flex:none;
}
.btn--settled { background:var(--ok); }
```

- [ ] **Step 2: 把五個 A 類畫面包進 `.pane`**

五個 `<sc-if>`（`isLogin`／`isNickname`／`isNewTask`／`isShare`／`isAdd`）內最外層那個 `<div style="flex:1; display:flex; flex-direction:column; ...">` 改成：

```html
<div class="screen">
  <div class="pane"> ... 原內容 ... </div>
</div>
```

原本寫在 inline style 的左右 padding（`padding:0 30px`、`padding:20px 26px 34px` 等）刪除，改由 `.pane` 的 `padding:0 20px` 統一。上下 padding 保留在各畫面自己的 inline style 上。

- [ ] **Step 3: 換掉表單元素的 style 綁定**

把 `style="{{ inputStyle }}"` 全部改成 `class="input"`，`style="{{ labelStyle }}"` 改成 `class="field__label"`，`style="{{ primaryBtn }}"` 改成 `class="btn btn--primary"`，`style="{{ ghostBtn }}"` 改成 `class="btn btn--ghost"`，`style="{{ backBtn }}"` 改成 `class="btn btn--back"`。

`renderVals()` 中對應刪除 `primaryBtn`、`ghostBtn`、`backBtn`、`inputStyle`、`labelStyle` 五個區域變數與回傳 key。

`settleBtnStyle` 改為回傳 class 名（因為它依 `settled` state 變色）：

```js
settleBtnClass: "btn btn--primary" + (s.settled ? " btn--settled" : ""),
```

markup 中 `style="{{ settleBtnStyle }}"` 改成 `class="{{ settleBtnClass }}"`。

- [ ] **Step 4: 驗證 — 置中與可讀寬度**

在 **390px**：五個 A 類畫面滿版顯示，左右各有 20px 內距，無橫向捲動。

在 **768px** 與 **1440px**：五個畫面的內容收成置中一欄，**量測欄寬不超過 480px**（DevTools 選取 `.pane` 看 computed width），左右留白對稱。

功能複查：新增支出頁的分類 chip、付款人 chip、分攤成員勾選都仍可點且狀態正確。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: A 類畫面置中限寬 480px

登入/建暱稱/建立任務/邀請連結/新增支出改用 .pane 容器，
表單與按鈕樣式從 JS 字串移到 CSS class。未使用媒體查詢。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 任務列表自適應 grid

任務卡片在手機單欄、桌機自動排多欄。**本 Task 同樣不寫媒體查詢**，靠 `auto-fill` 達成。

**Files:**
- Modify: `index.html`（`<helmet><style>`、`isTasks` 區塊）

**Interfaces:**
- Consumes: Task 1 的 `.pane--wide`、Task 2 的 `.card`。
- Produces: `.task-grid`。

- [ ] **Step 1: 加入 grid 規則**

追加到 `<helmet><style>`：

```css
.task-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));
  gap:14px;
  align-items:start;
}
```

- [ ] **Step 2: 套用到任務列表**

`isTasks` 區塊中，原本 `style="flex:1; overflow:auto; padding:0 26px 24px; display:flex; flex-direction:column; gap:12px;"` 的容器改成：

```html
<div class="scroll">
  <div class="pane pane--wide task-grid"> ... 兩張任務卡 ... </div>
</div>
```

同區塊上方的問候列（「哈囉，{{ nickname }}」／「我的分帳」）與下方的「＋ 建立分帳任務」按鈕，各自也包一層 `<div class="pane pane--wide">`，讓它們的左右邊界與卡片格線對齊。

- [ ] **Step 3: 驗證 — 欄數隨寬度變化**

- **390px**：一欄。卡片滿版，無橫向捲動。
- **768px**：兩欄。
- **1440px**：三欄或四欄（依 `minmax(320px,1fr)` 自動決定），且整體不超過 1200px、置中。
- 任一寬度下點第一張卡片都能進入任務內頁。
- 問候列「我的分帳」的左邊界與第一張卡片的左邊界**對齊**。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 任務列表改用 auto-fill grid

手機單欄、桌機自動多欄，容器上限 1200px 置中。未使用媒體查詢。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 任務內頁兩欄版面（唯一的 960px 斷點）

本計畫中**唯一**使用媒體查詢的 Task。支出／成員／結算三個 panel 在 markup 中各出現一次，排列隨寬度變化。

**Files:**
- Modify: `index.html`（`<helmet><style>`、`isTask` 區塊、`renderVals()` 的頁籤樣式）

**Interfaces:**
- Consumes: Task 1 的 `.pane--wide`、Task 2 的 `.card`。
- Produces: `.task-body`／`.panel`／`.panel-expenses`／`.panel-members`／`.panel-settle`／`.tabs`／`.tab`／`.tab-settle`，以及容器上的 `data-tab` 屬性。

- [ ] **Step 1: 加入版面與 panel 規則**

追加到 `<helmet><style>`。**注意 `@media` 內的 960px 必須是字面值，不可寫成 `var(--bp)`**：

```css
.task-body { display:grid; grid-template-columns:1fr; gap:14px; align-items:start; }

.panel { display:none; }
.panel.is-on { display:block; }

.tabs { display:flex; gap:6px; margin-bottom:14px; }
.tab {
  flex:1; height:38px; border-radius:12px; border:none;
  font-size:13px; font-weight:700; cursor:pointer;
  background:#F0EBE4; color:var(--muted);
}
.tab.is-on { background:var(--ink); color:#fff; }

@media (min-width: 960px) {
  .task-body { grid-template-columns:minmax(0,1fr) 340px; }

  /* 結算面板常駐右欄 */
  .panel-settle { display:block; grid-column:2; grid-row:1; }

  /* 結算退出頁籤列 */
  .tab-settle { display:none; }

  /* 若使用者在窄螢幕停在「結算」頁籤後放大視窗，
     左欄會兩個 panel 都隱藏而留白 —— 此時退化為顯示支出。
     選擇器特異性 (0,2,0) 高於 .panel/.tab 的 (0,1,0)，可覆蓋。*/
  [data-tab="settle"] .panel-expenses { display:block; }
  [data-tab="settle"] .tab-expenses { background:var(--ink); color:#fff; }
}
```

- [ ] **Step 2: 重組 `isTask` 的 markup**

`isTask` 區塊改成這個結構（內容沿用現有的，只換外框與 class）：

```html
<div class="screen" data-tab="{{ tab }}">
  <div class="pane pane--wide">
    <!-- 現有的返回鍵 + 標題 + 分享鍵 -->
  </div>
  <div class="scroll">
    <div class="pane pane--wide">
      <div class="tabs">
        <button onClick="{{ tabExpenses }}" class="{{ tabExpClass }}">支出</button>
        <button onClick="{{ tabMembers }}" class="{{ tabMemClass }}">成員</button>
        <button onClick="{{ tabSettle }}" class="{{ tabSetClass }}">結算</button>
      </div>
      <div class="task-body">
        <div class="{{ panelExpClass }}"> ... 現有支出列表 ... </div>
        <div class="{{ panelMemClass }}"> ... 現有成員列表 ... </div>
        <div class="{{ panelSetClass }}"> ... 現有結算內容 ... </div>
      </div>
    </div>
  </div>
  <!-- 現有的「＋ 新增支出」按鈕，Task 5 會處理其響應式行為 -->
</div>
```

三個 panel 原本各自包在 `<sc-if value="{{ onExpenses }}">` 之類的條件內——**把這三個 `<sc-if>` 拿掉**，改由 class 上的 `is-on` 控制顯隱。這是本 Task 的關鍵：`sc-if` 會把元素從 DOM 移除，CSS 就無法在寬螢幕把結算面板拉回右欄。

- [ ] **Step 3: 在 `renderVals()` 產出對應 class**

刪除 `tab()` 區域函式與 `tabExpStyle`／`tabMemStyle`／`tabSetStyle` 三個 key。新增：

```js
tab: s.tab,
tabExpClass: "tab tab-expenses" + (s.tab === "expenses" ? " is-on" : ""),
tabMemClass: "tab tab-members"  + (s.tab === "members"  ? " is-on" : ""),
tabSetClass: "tab tab-settle"   + (s.tab === "settle"   ? " is-on" : ""),
panelExpClass: "panel panel-expenses" + (s.tab === "expenses" ? " is-on" : ""),
panelMemClass: "panel panel-members"  + (s.tab === "members"  ? " is-on" : ""),
panelSetClass: "panel panel-settle"   + (s.tab === "settle"   ? " is-on" : ""),
```

`onExpenses`／`onMembers`／`onSettle` 三個 key 仍被 Task 5 的底部按鈕條件用到，**保留不刪**。

- [ ] **Step 4: 驗證 — 斷點兩側行為**

在 **1024px**（斷點以上）：
1. 任務內頁呈兩欄，右欄寬 340px，結算內容（TOTAL 黑卡、每人收支、轉帳建議、使用匯率、結算鈕）**常駐可見**
2. 頁籤列只有兩顆：`[支出] [成員]`
3. 點「成員」→ 左欄換成成員列表，右欄結算**不動**
4. 點成員的「設為管理者」→ 該列樣式變化且右欄不受影響

在 **390px**（斷點以下）：
5. 單欄，頁籤列三顆 `[支出] [成員] [結算]`
6. 三個頁籤各自只顯示一個 panel，切換正常

**降級規則專項驗證**（spec 驗收標準明列）：
7. 在 390px 點「結算」頁籤，接著把寬度拉到 1024px → 左欄顯示**支出列表**（不是空白），且「支出」頁籤呈選中樣式，右欄結算正常
8. 再把寬度縮回 390px → 回到結算頁籤的畫面（`tab` state 未被改動）

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 任務內頁寬螢幕兩欄，結算面板常駐右欄

三個 panel 改由 CSS class 控制顯隱（移除 sc-if，否則 DOM 中不存在
就無法在寬螢幕重排）。加入全檔唯一的 960px 媒體查詢，含 settle
頁籤在寬螢幕降級為支出的規則。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 共用 header、主要按鈕響應式，與最終驗收

**Files:**
- Modify: `index.html`（`<helmet><style>`、`isTasks`／`isNewTask`／`isShare`／`isTask`／`isAdd` 五個區塊的頂部與底部）

**Interfaces:**
- Consumes: Task 1–4 的全部 class。
- Produces: `.hdr`／`.hdr__brand`／`.hdr__me`／`.actionbar`。

- [ ] **Step 1: 加入 header 與 actionbar 規則**

追加到 `<helmet><style>`：

```css
.hdr {
  display:flex; align-items:center; gap:12px;
  padding:12px 0; border-bottom:1px solid var(--line);
  background:var(--card);
}
.hdr__wrap { position:sticky; top:0; z-index:10; background:var(--card); }
.hdr__title { flex:1; min-width:0; }
.hdr__brand, .hdr__me { display:none; }

.actionbar {
  position:sticky; bottom:0;
  padding:14px 0 22px;
  background:linear-gradient(to top, var(--paper) 72%, rgba(251,250,248,0));
}

@media (min-width: 960px) {
  .hdr__brand { display:flex; align-items:center; gap:9px; }
  .hdr__me { display:flex; align-items:center; gap:9px; }

  .actionbar { position:static; display:flex; justify-content:flex-end; background:none; }
  .actionbar .btn--primary { width:auto; min-width:210px; padding:0 28px; }
}
```

`.hdr__brand` 與 `.hdr__me` 只是在既有 header 上追加的元素，窄螢幕隱藏、寬螢幕顯示——**不新增分支，同一棵 markup。**

- [ ] **Step 2: 套用 header 到五個登入後畫面**

`isTasks`／`isNewTask`／`isShare`／`isTask`／`isAdd` 五個區塊的頂部改成同一個結構：

```html
<div class="hdr__wrap">
  <div class="pane pane--wide">
    <div class="hdr">
      <span class="hdr__brand">
        <span style="width:28px; height:28px; border-radius:10px; background:var(--brand); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900;">分</span>
        <span style="font-size:14px; font-weight:900;">分帳系統</span>
      </span>
      <button onClick="{{ goTasks }}" class="btn btn--back">←</button>
      <div class="hdr__title"> ... 各畫面自己的標題 ... </div>
      <span class="hdr__me">
        <span style="{{ meAvatar }}">{{ nickInitial }}</span>
      </span>
    </div>
  </div>
</div>
```

`isTasks` 是列表首頁，**該畫面不放返回鍵**（刪掉那顆 `btn--back`），其餘四個保留。各畫面原有的返回鍵目標不同（`isAdd` 是 `openTask`、`isTask` 是 `goTasks`），沿用各自原本的 handler，不要一律改成 `goTasks`。

`renderVals()` 新增頭像樣式（顏色來自資料，必須 inline）：

```js
meAvatar: this.avatar(s.nickname, 30),
```

`this.avatar()` 以 `AV[name]` 查色，而 `AV` 只有四位成員的鍵。暱稱被改成其他字串時會查到 `undefined`，需在 `avatar()` 加 fallback：

```js
avatar = (name, size) => `width:${size}px;height:${size}px;border-radius:50%;background:${AV[name] || "#E8590C"};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.42)}px;font-weight:700;flex:none;`;
```

登入與建暱稱兩個畫面**不加 header**，維持全版式版面。

- [ ] **Step 3: 套用 actionbar 到底部主要按鈕**

`isTasks`（＋建立分帳任務）、`isNewTask`（建立並取得邀請連結）、`isTask` 的支出頁籤（＋新增支出）、`isAdd`（儲存支出）四處的底部按鈕，外層容器改成：

```html
<div class="actionbar">
  <div class="pane pane--wide">
    <button onClick="{{ ... }}" class="btn btn--primary">...</button>
  </div>
</div>
```

A 類畫面（`isNewTask`／`isAdd`）用 `<div class="pane">`（480px），B 類（`isTasks`／`isTask`）用 `<div class="pane pane--wide">`。

`isTask` 底部按鈕原本包在 `<sc-if value="{{ onExpenses }}">` 內——**保留這個條件**，成員與結算頁籤不該出現「新增支出」。但在寬螢幕、`tab === "settle"` 的降級情境下左欄顯示的是支出，此時按鈕會消失。改用 `onExpenses || onSettle` 判斷：`renderVals()` 新增

```js
showAddBtn: s.tab === "expenses" || s.tab === "settle",
```

markup 條件改為 `<sc-if value="{{ showAddBtn }}">`。窄螢幕停在結算頁籤時多一顆「新增支出」是可接受的——結算頁本來就常要補記漏掉的帳。

- [ ] **Step 4: 最終驗收 — 四個寬度的完整流程**

依 spec「驗收標準」逐項確認。**每個寬度都要走完整流程**：登入 → 建暱稱 → 任務列表 → 建立任務 → 邀請連結 → 任務內頁三個面板 → 新增支出 → 儲存返回。

**390px（手機直立）**
- 單欄；無橫向捲動（DevTools Console 執行 `document.documentElement.scrollWidth <= window.innerWidth` 應為 `true`）
- 主要按鈕吸附底部，捲動內容時按鈕不隨之捲走
- header 不顯示 logo 與使用者頭像

**768px（平板）**
- 仍為單欄（任務內頁未變兩欄）
- A 類畫面已收成置中卡片，寬度 480px
- header 仍不顯示 logo 與頭像（斷點是 960，768 在其下）

**1024px（小筆電）**
- 任務內頁兩欄，結算常駐右側
- header 顯示 logo 與使用者頭像
- 主要按鈕靠右、寬度約 210px，不再吸附底部

**1440px（桌機）**
- 內容不無限延展：任務列表與任務內頁上限 1200px 且置中；A 類畫面上限 480px 且置中
- 任務列表排成多欄

**專項**
- 390px 選「結算」→ 放大到 1024px → 左欄顯示支出、支出頁籤選中、右欄結算正常
- 全域搜尋 `index.html` 確認以下字串**都不存在**：`phoneShell`、`desktopWindow`、`dtRail`、`setPhone`、`setDesktop`、`setAuto`、`widthLabel`、`homeBarColor`、`statusColor`、`navItems`
- 全域搜尋確認 `@media` 在整份檔案中只出現在 Task 4 與 Task 5 兩處，且條件都是 `(min-width: 960px)`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 共用 header 與主要按鈕響應式規則

五個登入後畫面共用同一條 header，寬螢幕追加 logo 與使用者頭像。
主要按鈕窄螢幕吸附底部、寬螢幕靠右自適應寬度。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 推送**

```bash
git push origin main
```

（remote 已設為 `https://superdyco@github.com/superdyco/SplitFlow.git`，URL 內的帳號是必要的——不帶帳號會被公司帳號憑證擋下並回 403。）

---

## Self-Review 紀錄

對照 spec 逐節檢查：

| Spec 章節 | 對應 Task |
|---|---|
| 決策一：移除原型鷹架（8 個項目） | Task 1 Step 2–6 |
| 決策二：單一斷點 960px | Task 4 Step 1、Task 5 Step 1（全檔僅此兩處，Task 5 Step 4 有驗證） |
| 決策三：A 類畫面 | Task 2 |
| 決策三：B 類—任務列表 | Task 3 |
| 決策四：任務內頁面板重排 | Task 4 |
| 決策四：頁籤狀態與寬度交互（settle 降級） | Task 4 Step 1、Step 4 第 7–8 項 |
| 決策五：共用 header | Task 5 Step 1–2 |
| 決策五：主要按鈕 | Task 5 Step 1、Step 3 |
| 實作方式：class ＋ helmet style | Task 1 Step 1，各 Task 逐步遷移 |
| 實作方式：state 變更 | Task 1 Step 5–6 |
| 實作方式：transfers() 重複呼叫 | Task 1 Step 7 |
| 驗收標準（四個寬度） | Task 5 Step 4 |
| 範圍外 | Global Constraints |

計畫執行中發現、spec 未涵蓋而需在此明確處理的三點：

1. **`sc-if` 與 CSS 重排衝突** — 三個 panel 原本用 `sc-if` 包住，條件不成立時元素根本不在 DOM 裡，CSS 無法把結算面板拉到右欄常駐。Task 4 Step 2 改為一律渲染、用 class 控制顯隱。
2. **`avatar()` 對非預設暱稱會查到 `undefined`** — header 要顯示使用者頭像才暴露出來（`AV` 只有四位成員的鍵）。Task 5 Step 2 加上 fallback 色。
3. **寬螢幕降級情境下「新增支出」鈕會消失** — 原條件是 `onExpenses`，但降級時 `tab` 仍是 `settle`。Task 5 Step 3 改為 `showAddBtn`。
