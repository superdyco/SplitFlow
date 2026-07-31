# SplitFlow

SplitFlow 第一個可驗收版本已從 Prototype 重新實作為標準 Vue 3 專案。

## 技術

- Vue 3 + Vite + TypeScript
- Composition API + `<script setup>`
- Vue Router
- Pinia
- Firebase Authentication: Google 登入
- Cloud Firestore
- Firebase Hosting
- 手機優先 RWD

Prototype 的 `<x-dc>`、`<sc-if>`、`<sc-for>`、`DCLogic` 沒有留在正式 Vue component 內。

## 啟動

```bash
npm install
npm run dev
```

Build：

```bash
npm run build
```

## 環境變數

複製 `.env.example` 成 `.env`：

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

不要把正式 Firebase 設定寫死在程式碼裡。

## Firestore 資料結構

`users/{uid}`

```ts
{
  uid: string,
  nickname: string,
  email: string,
  photoURL: string | null,
  provider: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`tasks/{taskId}`

```ts
{
  name: string,
  ownerId: string,
  adminIds: string[],
  memberIds: string[],
  defaultCurrency: string,
  startDate: string | null,
  endDate: string | null,
  status: "active",
  inviteCode: string,
  memberCount: number,
  expenseCount: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`tasks/{taskId}/members/{uid}`

```ts
{
  uid: string,
  nickname: string,
  role: "owner" | "admin" | "member",
  joinedAt: Timestamp,
  active: true
}
```

`invites/{inviteCode}` 保留邀請預覽所需欄位：taskId、taskName、defaultCurrency、日期與狀態。這樣未登入者可以看到邀請預覽，但不能讀取完整 task 文件。

## Firestore Rules

規則在 `firestore.rules`。為了讓 Security Rules 可以安全判斷任務成員，task 文件保留 `memberIds`。加入任務時使用 transaction 同時建立自己的 member 文件與更新 task 的 `memberIds/memberCount`，避免重複加入。

部署 rules：

```bash
firebase deploy --only firestore:rules
```

## Firebase Console 需手動設定

- Authentication 啟用 Google provider。
- Authentication 的 Authorized domains 加入 `localhost` 與正式部署網域。
- 建立 Firestore Database。
- 若要部署 Hosting，建立專案並確認 `.firebaserc` 指到正確 project。

## 第一版已完成

- Google 真實登入與登出。
- Router guard 等待 Firebase 初始化後判斷登入狀態。
- 第一次登入建立暱稱並寫入 Firestore。
- 個人設定頁可查看 email、修改暱稱、登出。
- 建立分帳任務並建立 owner member。
- 建立不可輕易猜測的 inviteCode 與 invite 文件。
- 任務列表從 Firestore 讀取，不依賴 localStorage。
- 邀請連結 `/join/:inviteCode` 可預覽、登入、建立暱稱後加入。
- 加入任務使用 Firestore transaction，重複開啟不會重複增加成員。
- 任務內頁包含支出、成員、結算三頁籤。
- 成員頁籤讀取 Firestore 真實成員。
- owner/admin 與 member 看到的介面不同。
- 無權限 taskId 會顯示無權限/Firestore 錯誤狀態。

## 下一階段 TODO

- 新增、編輯、刪除支出。
- 即時匯率 API。
- Google Maps / Google Places。
- 自訂金額分攤。
- 複雜結算演算法。
- Facebook 登入。
- 已付款確認。
- 歷史結算版本。
- 桌面版專用介面。

## 兩個帳號驗收

帳號 A：

1. 開啟網站並 Google 登入。
2. 第一次登入建立暱稱。
3. 建立分帳任務。
4. 確認 Firestore 有 task、owner member、invite。
5. 複製邀請連結並進入任務頁。
6. 應看到 owner/admin 管理區與邀請按鈕。

帳號 B：

1. 無痕視窗開啟邀請連結。
2. 看到邀請預覽。
3. 用另一個 Google 帳號登入。
4. 第一次登入建立暱稱。
5. 按加入任務。
6. 確認 Firestore 出現第二位 member，task.memberCount +1。
7. 帳號 B 可看到任務與成員，但看不到 owner/admin 管理區。
