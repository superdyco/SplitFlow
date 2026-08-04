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
import { settleWrite } from "@/utils/offlineWrite";
import { firebaseErrorMessage } from "@/utils/firestore";
import {
  createReport,
  findReport,
  newReportId,
  setReportActive,
  updateReport
} from "@/services/reportService";
import { fetchStaticMap, reportMapPath } from "@/services/staticMap";

export function useTripReport(taskId: string) {
  const report = ref<TripReport | null>(null);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const shareUrl = computed(() =>
    report.value ? `${window.location.origin}/r/${taskId}/${report.value.id}` : ""
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

  /** 地圖失敗一律回傳 null —— 呼叫端把它當成「這份報告沒有地圖」。 */
  async function uploadMap(reportId: string, blob: Blob): Promise<string | null> {
    try {
      const { getStorage, ref: storageRef, uploadBytes } = await import("firebase/storage");
      const { app } = await import("@/firebase/config");
      const path = reportMapPath(taskId, reportId);
      await uploadBytes(storageRef(getStorage(app), path), blob, { contentType: "image/png" });
      return path;
    } catch {
      return null;
    }
  }

  async function generate(task: Task, expenses: Expense[]) {
    busy.value = true;
    error.value = null;
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

      const blob = await fetchStaticMap(places);
      const mapPath = blob ? await uploadMap(reportId, blob) : null;

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
          mapPath,
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

  return { report, loading, busy, error, shareUrl, load, generate, setActive };
}
