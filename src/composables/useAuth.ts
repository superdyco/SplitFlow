import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";

export function useAuth() {
  const store = useAuthStore();
  const { user, initialized } = storeToRefs(store);
  const isAuthenticated = computed(() => !!user.value);

  return {
    user,
    initialized,
    isAuthenticated
  };
}
