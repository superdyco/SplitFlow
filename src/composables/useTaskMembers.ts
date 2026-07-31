import { ref } from "vue";
import type { TaskMember } from "@/types/member";
import { listTaskMembers } from "@/services/memberService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useTaskMembers(taskId: string) {
  const members = ref<TaskMember[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      members.value = await listTaskMembers(taskId);
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    members,
    loading,
    error,
    load
  };
}
