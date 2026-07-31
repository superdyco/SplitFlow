import { storeToRefs } from "pinia";
import { useUserStore } from "@/stores/user";

export function useCurrentUser() {
  const store = useUserStore();
  const { profile } = storeToRefs(store);

  return {
    profile,
    hasProfile: store.hasNickname
  };
}
