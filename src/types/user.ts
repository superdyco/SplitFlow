import type { Timestamp } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  nickname: string;
  email: string;
  photoURL: string | null;
  provider: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /*
    最後一次開啟 app 的時間與裝置，一天最多寫一次（見 presenceService）。

    兩個都是選填：這個功能之前建立的檔案沒有這兩個欄位，直接讀會拿到
    undefined —— 同一個坑 `virtual` 與 `listed` 都踩過。讀的地方一律要
    當成「可能不存在」，不要假設每個人都有。
  */
  lastSeenAt?: Timestamp;
  lastPlatform?: "web" | "android" | "ios";
}
