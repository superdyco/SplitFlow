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
    }
  }
});
