import { ref } from "vue";
import type { Payment } from "@/types/payment";
import { listPayments } from "@/services/paymentService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function usePayments(taskId: string) {
  const payments = ref<Payment[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      payments.value = await listPayments(taskId);
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    payments,
    loading,
    error,
    load
  };
}
