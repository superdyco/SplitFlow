import type { Expense } from "@/types/expense";
import type { Payment } from "@/types/payment";
import type {
  MemberBalance,
  Settlement,
  SettlementSnapshot,
  SettlementSnapshotInput,
  Transfer
} from "@/types/settlement";
import { allocate } from "@/utils/currency";

/** 依成員加入順序排出參與者，任務成員在前，已離開但還出現在支出裡的排在後面。 */
function orderParticipants(uids: Set<string>, memberOrder: string[]): string[] {
  const known = memberOrder.filter(uid => uids.has(uid));
  const knownSet = new Set(known);
  const extra = [...uids].filter(uid => !knownSet.has(uid)).sort();
  return [...known, ...extra];
}

/**
 * 支出換算成主要幣別後，每個人分攤多少。
 * 用原幣別的分攤金額當權重去分配 baseAmount，所以換算後的總和一定還是等於 baseAmount，
 * 不會因為每筆各自四捨五入而多出或少掉幾分錢。
 */
export function baseSplitsOf(expense: Expense, baseAmount: number, memberOrder: string[]): Map<string, number> {
  const uids = orderParticipants(new Set(Object.keys(expense.splits)), memberOrder);
  const shares = allocate(baseAmount, uids.map(uid => expense.splits[uid] ?? 0));
  return new Map(uids.map((uid, index) => [uid, shares[index]]));
}

/** 記帳當下換算好的金額，同幣別的舊資料可以直接沿用原金額。 */
export function baseAmountOf(expense: Expense, baseCurrency: string): number | null {
  if (expense.baseAmount !== null) return expense.baseAmount;
  return expense.currency === baseCurrency ? expense.amount : null;
}

/** 貪婪配對：金額最大的應付對上金額最大的應收，讓轉帳筆數盡量少。 */
function buildTransfers(balances: MemberBalance[]): Transfer[] {
  const byAmountDesc = (a: { uid: string; amount: number }, b: { uid: string; amount: number }) =>
    b.amount - a.amount || a.uid.localeCompare(b.uid);

  const creditors = balances
    .filter(item => item.balance > 0)
    .map(item => ({ uid: item.uid, amount: item.balance }))
    .sort(byAmountDesc);
  const debtors = balances
    .filter(item => item.balance < 0)
    .map(item => ({ uid: item.uid, amount: -item.balance }))
    .sort(byAmountDesc);

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) transfers.push({ from: debtor.uid, to: creditor.uid, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtorIndex += 1;
    if (creditor.amount === 0) creditorIndex += 1;
  }

  return transfers;
}

/**
 * 從真實支出與已確認的付款算出結算結果，全部換算成任務的主要幣別。
 *
 * 換算用的是記帳當下存進支出的匯率，不是現在的匯率，所以同一筆帳今天看跟昨天看是一樣的。
 * 付款在數學上就是一筆「付款人先付、收款人獨自分攤」的支出，所以直接併進同一組帳裡算，
 * 剩下的建議轉帳會自動扣掉已經付掉的部分。還沒被收款人確認的付款不算數。
 */
export function settleExpenses(
  expenses: Expense[],
  payments: Payment[],
  memberOrder: string[],
  baseCurrency: string
): Settlement {
  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  const participants = new Set<string>();
  const unconverted: Expense[] = [];
  let total = 0;
  let counted = 0;
  let paidTotal = 0;

  for (const expense of expenses) {
    const baseAmount = baseAmountOf(expense, baseCurrency);
    if (baseAmount === null) {
      unconverted.push(expense);
      continue;
    }

    total += baseAmount;
    counted += 1;
    participants.add(expense.paidBy);
    paid.set(expense.paidBy, (paid.get(expense.paidBy) ?? 0) + baseAmount);

    for (const [uid, share] of baseSplitsOf(expense, baseAmount, memberOrder)) {
      participants.add(uid);
      owed.set(uid, (owed.get(uid) ?? 0) + share);
    }
  }

  for (const payment of payments) {
    if (payment.status !== "confirmed") continue;
    paidTotal += payment.amount;
    participants.add(payment.from);
    participants.add(payment.to);
    paid.set(payment.from, (paid.get(payment.from) ?? 0) + payment.amount);
    owed.set(payment.to, (owed.get(payment.to) ?? 0) + payment.amount);
  }

  const balances = orderParticipants(participants, memberOrder).map(uid => {
    const paidAmount = paid.get(uid) ?? 0;
    const owedAmount = owed.get(uid) ?? 0;
    return { uid, paid: paidAmount, owed: owedAmount, balance: paidAmount - owedAmount };
  });

  return {
    currency: baseCurrency,
    total,
    expenseCount: counted,
    paidTotal,
    balances,
    transfers: buildTransfers(balances),
    unconverted
  };
}

/**
 * 把即時算出來的結算轉成可以存進 Firestore 的快照。
 * 暱稱一起存進去，之後有人改暱稱或被移除都不會改寫這份歷史紀錄。
 */
export function toSnapshotInput(
  settlement: Settlement,
  memberNames: Record<string, string>,
  note: string
): SettlementSnapshotInput {
  const involved = new Set(settlement.balances.map(item => item.uid));
  return {
    currency: settlement.currency,
    total: settlement.total,
    paidTotal: settlement.paidTotal,
    expenseCount: settlement.expenseCount,
    balances: settlement.balances.map(item => ({ ...item })),
    transfers: settlement.transfers.map(item => ({ ...item })),
    memberNames: Object.fromEntries(
      [...involved].map(uid => [uid, memberNames[uid] ?? "已離開的成員"])
    ),
    note
  };
}

/**
 * 目前的帳目跟這份快照存下來時是不是一樣。
 * 用來提示「上次結算之後又有新的變動」，只看會影響誰欠誰的欄位。
 */
export function matchesSnapshot(settlement: Settlement, snapshot: SettlementSnapshot): boolean {
  if (settlement.currency !== snapshot.currency) return false;
  if (settlement.total !== snapshot.total) return false;
  if (settlement.paidTotal !== snapshot.paidTotal) return false;
  if (settlement.expenseCount !== snapshot.expenseCount) return false;
  if (settlement.balances.length !== snapshot.balances.length) return false;

  const before = new Map(snapshot.balances.map(item => [item.uid, item.balance]));
  return settlement.balances.every(item => before.get(item.uid) === item.balance);
}
