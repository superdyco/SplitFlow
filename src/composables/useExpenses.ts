import { computed, ref } from "vue";
import type { Expense } from "@/types/expense";
import { listExpenses } from "@/services/expenseService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useExpenses(taskId: string) {
  const expenses = ref<Expense[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  const isEmpty = computed(() => !loading.value && expenses.value.length === 0);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      expenses.value = await listExpenses(taskId);
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    expenses,
    loading,
    error,
    isEmpty,
    load
  };
}
