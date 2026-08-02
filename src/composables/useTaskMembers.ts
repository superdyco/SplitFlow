import { computed, ref } from "vue";
import type { TaskMember } from "@/types/member";
import { listTaskMembers } from "@/services/memberService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useTaskMembers(taskId: string) {
  /** 包含被移除的成員，舊支出要靠這份資料查暱稱。 */
  const members = ref<TaskMember[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  /** 還在任務裡的成員，畫面上可以選擇或操作的就是這些。 */
  const activeMembers = computed(() => members.value.filter(member => member.active));

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
    activeMembers,
    loading,
    error,
    load
  };
}
