import { computed, ref } from "vue";
import type { Task } from "@/types/task";
import type { TaskMember } from "@/types/member";
import { getTask } from "@/services/taskService";
import { getTaskMember } from "@/services/memberService";
import { firebaseErrorMessage } from "@/utils/firestore";

export function useTask(taskId: string, uid: string) {
  const task = ref<Task | null>(null);
  const member = ref<TaskMember | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);

  const isOwner = computed(() => member.value?.role === "owner");
  const isAdmin = computed(() => member.value?.role === "owner" || member.value?.role === "admin");
  const isMember = computed(() => !!member.value?.active);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const [taskData, memberData] = await Promise.all([getTask(taskId), getTaskMember(taskId, uid)]);
      task.value = taskData;
      member.value = memberData;
      if (!taskData) error.value = "找不到這個分帳任務";
      else if (!memberData) error.value = "你沒有權限查看這個分帳任務";
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    task,
    member,
    loading,
    error,
    isOwner,
    isAdmin,
    isMember,
    load
  };
}
