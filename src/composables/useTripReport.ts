/**
 * 旅費報告的產生、撤銷與狀態。
 *
 * 產生的順序刻意是「先算數字、再拍地圖、最後寫文件」，而且**地圖失敗不擋流程** ——
 * 地圖是加分不是必要，反過來設計的話 Static Maps 一出問題（配額、金鑰、網路）
 * 整個功能就掛了。
 */
import { computed, ref } from "vue";
import type { Expense } from "@/types/expense";
import type { Task } from "@/types/task";
import type { TripReport } from "@/types/report";
import { categoryTotals } from "@/utils/categoryTotals";
import { placeTotals } from "@/utils/placeTotals";
import { tripSummary } from "@/utils/tripSummary";
import { reportTimeline } from "@/utils/reportTimeline";
import { settleWrite } from "@/utils/offlineWrite";
import { firebaseErrorMessage } from "@/utils/firestore";
import {
  createReport,
  findReport,
  newReportId,
  setReportActive,
  updateReport
} from "@/services/reportService";
import { fetchStaticMap, MAX_MAP_BYTES } from "@/services/staticMap";
import { reportMapPath } from "@/services/reportMap";

export function useTripReport(taskId: string) {
  const report = ref<TripReport | null>(null);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  /**
   * 報告產出來了、但地圖沒做出來的原因。跟 error 分開：報告是成功的，
   * 混在一起會讓人以為整份報告失敗了。
   */
  const mapWarning = ref<string | null>(null);

  /** 站內路徑。要傳出去的是 shareUrl，這條是給 RouterLink 用的。 */
  const sharePath = computed(() => (report.value ? `/r/${taskId}/${report.value.id}` : ""));

  const shareUrl = computed(() =>
    sharePath.value ? `${window.location.origin}${sharePath.value}` : ""
  );

  async function load() {
    loading.value = true;
    try {
      report.value = await findReport(taskId);
    } catch {
      // 找不到既有報告不是錯誤，就是還沒產生過。
      report.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** 地圖失敗不擋報告，但要講得出原因 —— 回傳 path 或說明。 */
  async function uploadMap(
    reportId: string,
    blob: Blob
  ): Promise<{ path: string | null; reason: string | null }> {
    // 先自己擋一次，錯誤訊息才看得懂。交給規則擋的話只會拿到 unauthorized。
    if (blob.size > MAX_MAP_BYTES) {
      const kb = Math.round(blob.size / 1024);
      return { path: null, reason: `地圖圖檔 ${kb} KB，超過 Storage 規則的 1 MB 上限。` };
    }

    try {
      const { getStorage, ref: storageRef, uploadBytes } = await import("firebase/storage");
      const { app } = await import("@/firebase/config");
      const path = reportMapPath(taskId, reportId);
      await uploadBytes(storageRef(getStorage(app), path), blob, { contentType: "image/png" });
      return { path, reason: null };
    } catch (err) {
      return { path: null, reason: `地圖上傳失敗：${firebaseErrorMessage(err)}` };
    }
  }

  async function generate(task: Task, expenses: Expense[]) {
    busy.value = true;
    error.value = null;
    mapWarning.value = null;
    try {
      // 沿用既有 id，連結才不會變。已經傳出去的網址得繼續有效。
      const existing = report.value;
      const reportId = existing?.id ?? newReportId();
      const currency = task.defaultCurrency;
      const places = placeTotals(expenses, currency);
      const summary = tripSummary({
        expenses,
        baseCurrency: currency,
        memberCount: task.memberCount,
        startDate: task.startDate,
        endDate: task.endDate
      });

      const map = await fetchStaticMap(places);
      const uploaded = map.blob
        ? await uploadMap(reportId, map.blob)
        : { path: null, reason: map.reason };
      mapWarning.value = uploaded.reason;

      // 既有的用 update 才不會把第一次產生的 createdAt 洗掉。
      const write = existing ? updateReport : createReport;
      await settleWrite(
        write(taskId, reportId, {
          taskName: task.name,
          currency,
          startDate: task.startDate,
          endDate: task.endDate,
          days: summary.days,
          memberCount: task.memberCount,
          expenseCount: summary.expenseCount,
          total: summary.total,
          perPerson: summary.perPerson,
          categories: categoryTotals(expenses, currency),
          places,
          timeline: reportTimeline(expenses, currency, task.startDate),
          mapPath: uploaded.path,
          active: true
        })
      );

      await load();
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      busy.value = false;
    }
  }

  async function setActive(active: boolean) {
    if (!report.value) return;
    busy.value = true;
    error.value = null;
    try {
      await settleWrite(setReportActive(taskId, report.value.id, active));
      await load();
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      busy.value = false;
    }
  }

  return {
    report,
    loading,
    busy,
    error,
    mapWarning,
    sharePath,
    shareUrl,
    load,
    generate,
    setActive
  };
}
