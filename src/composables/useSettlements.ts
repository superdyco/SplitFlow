import { ref } from "vue";
import type { SettlementSnapshot } from "@/types/settlement";
import { listSettlements } from "@/services/settlementService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useSettlements(taskId: string) {
  const snapshots = ref<SettlementSnapshot[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      snapshots.value = await listSettlements(taskId);
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    snapshots,
    loading,
    error,
    load
  };
}
