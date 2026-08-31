import { defineStore } from "pinia";
import type { User } from "firebase/auth";
import type { UserProfile } from "@/types/user";
import { createUserProfile, getUserProfile, updateNickname } from "@/services/userService";

export const useUserStore = defineStore("user", {
  state: () => ({
    profile: null as UserProfile | null,
    loadedForUid: null as string | null
  }),
  getters: {
    hasNickname: state => !!state.profile?.nickname
  },
  actions: {
    async load(uid: string) {
      this.profile = await getUserProfile(uid);
      this.loadedForUid = uid;
    },
    clear() {
      this.profile = null;
      this.loadedForUid = null;
    },
    async create(user: User, nickname: string) {
      await createUserProfile(user, nickname);
      await this.load(user.uid);
    },
    /**
     * 個人檔案先寫，再把新名字散到各個任務。順序不能反 —— 個人檔案是那個名字的
     * 出處，散播失敗至少改名本身有留下來，重新存一次就會補齊。
     *
     * memberService 是動態載入的，不是檔案最上面那排 import。這個 store 在啟動
     * 時就會被拉起來（路由守衛要看有沒有暱稱），靜態 import 會把整個成員模組
     * 連同它的下游一起塞進首屏那包 JS —— 為了一個只有按下「儲存暱稱」才會跑
     * 到的東西，讓每個人的每次開啟都多下載一份。
     */
    async updateNickname(uid: string, nickname: string) {
      await updateNickname(uid, nickname);
      const { syncNicknameToTasks } = await import("@/services/memberService");
      await syncNicknameToTasks(uid, nickname);
      await this.load(uid);
    }
  }
});
