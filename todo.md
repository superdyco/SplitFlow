# SplitFlow TODO

## 下一階段：支出功能

- 新增支出頁 `/tasks/:taskId/expenses/new`。
- 編輯支出頁 `/tasks/:taskId/expenses/:expenseId/edit`。
- 支出資料寫入 `tasks/{taskId}/expenses/{expenseId}`。
- 支出至少包含：
  - title
  - category
  - amount
  - currency
  - paidBy
  - splitMemberIds
  - createdBy
  - createdAt
  - updatedAt
- 任務內「支出」頁籤讀取 Firestore 真實支出資料。
- 一般成員只能新增、修改、刪除自己建立或自己先付的支出。
- owner/admin 可以修改所有支出。
- 更新 task 的 `expenseCount`。
- 補 Firestore rules 限制 expenses 權限。

## 結算功能

- 先實作簡單均分結算。
- 結算頁從真實 expenses 計算每人應收應付。
- 支援 task 的 defaultCurrency 顯示。
- 結算後仍允許修改支出。
- 重新結算時以最新支出重新計算。
- 不建立假結算數字。

## 邀請與成員管理

- owner/admin 可重新複製邀請連結。
- owner/admin 可停用 invite。
- owner/admin 可將 member 升級為 admin。
- owner/admin 可將 admin 降級為 member。
- admin 不可移除 owner。
- owner/admin 可移除一般 member。
- 被移除成員不可再讀取任務。

## 使用者體驗

- 補全 loading、empty、error 狀態細節。
- 建立任務後任務列表自動刷新。
- Join 頁如果已是成員，直接顯示「進入任務」。
- 無權限頁面做成正式頁，而不是只顯示錯誤文字。
- 表單欄位補 client-side validation。
- 手機版操作細節再貼近 prototype。

## 之後階段功能

- 即時匯率 API：open.er-api.com。
- 多幣別支出換算成新台幣。
- Google Maps 定位。
- Google Places nearby/autocomplete。
- 自訂金額分攤。
- 已付款確認。
- 歷史結算版本。
- Facebook 登入。
- 桌面版專用介面。

## Firebase / 部署

- 部署 Firestore rules：`firebase deploy --only firestore:rules`。
- 部署 Hosting：`npm run build` 後 `firebase deploy --only hosting`。
- Firebase Authentication Authorized domains 加入正式網域。
- GitHub 上目前包含 `.env`，正式公開前需確認 Firebase Web API key 與網域限制。
- 評估把 Firebase config 改回只透過部署環境變數管理。

## 技術整理

- Firebase bundle 目前讓主要 chunk 超過 500 kB，之後可評估 manualChunks。
- 補 ESLint / Prettier。
- 補基本單元測試或 Firebase emulator 測試。
- 補 Firestore indexes 文件。
