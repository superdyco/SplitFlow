import { defineStore } from "pinia";
import type { User } from "firebase/auth";
import type { UserProfile } from "@/types/user";
import { createUserProfile, getUserProfile, updateNickname } from "@/services/userService";
import { syncNicknameToTasks } from "@/services/memberService";

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
     */
    async updateNickname(uid: string, nickname: string) {
      await updateNickname(uid, nickname);
      await syncNicknameToTasks(uid, nickname);
      await this.load(uid);
    }
  }
});
