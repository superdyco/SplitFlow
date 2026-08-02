import { computed, ref } from "vue";
import { FirebaseError } from "firebase/app";
import type { Task } from "@/types/task";
import type { TaskMember } from "@/types/member";
import { getTask } from "@/services/taskService";
import { getTaskMember } from "@/services/memberService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useTask(taskId: string, uid: string) {
  const task = ref<Task | null>(null);
  const member = ref<TaskMember | null>(null);
  const loading = ref(true);
  /** 真的出錯（網路、Firestore 異常），可以重試。 */
  const error = ref<string | null>(null);
  /** 沒有權限看這個任務，重試沒有意義，要顯示無權限頁。 */
  const denied = ref(false);

  const isOwner = computed(() => member.value?.role === "owner");
  const isAdmin = computed(() => member.value?.role === "owner" || member.value?.role === "admin");
  const isMember = computed(() => !!member.value?.active);

  async function load() {
    loading.value = true;
    error.value = null;
    denied.value = false;
    try {
      const [taskData, memberData] = await Promise.all([getTask(taskId), getTaskMember(taskId, uid)]);
      task.value = taskData;
      member.value = memberData;

      if (!memberData?.active) denied.value = true;
      else if (!taskData) error.value = "找不到這個分帳任務";
    } catch (err) {
      // 不是成員時 Firestore 會直接擋掉讀取，對使用者來說就是沒有權限，不是壞掉。
      if (err instanceof FirebaseError && err.code === "permission-denied") denied.value = true;
      else error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    task,
    member,
    loading,
    error,
    denied,
    isOwner,
    isAdmin,
    isMember,
    load
  };
}
