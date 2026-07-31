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
    async updateNickname(uid: string, nickname: string) {
      await updateNickname(uid, nickname);
      await this.load(uid);
    }
  }
});
