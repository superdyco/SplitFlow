import { defineStore } from "pinia";
import type { User } from "firebase/auth";
import { watchAuth } from "@/services/authService";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as User | null,
    initialized: false,
    unsubscribe: null as null | (() => void)
  }),
  actions: {
    init() {
      if (this.unsubscribe) return;
      this.unsubscribe = watchAuth(user => {
        this.user = user;
        this.initialized = true;
      });
    },
    /**
     * 綁定帳號之後 uid 不變，onAuthStateChanged 不會再響 —— 但 isAnonymous 與
     * providerData 已經變了。先放 null 再放回去，讓看著它的畫面重算一次。
     */
    refresh(user: User | null) {
      this.user = null;
      this.user = user;
    }
  }
});
