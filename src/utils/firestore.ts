import type { FirestoreError } from "firebase/firestore";

export function firebaseErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const maybe = error as FirestoreError;
    return maybe.message || String(error);
  }
  return String(error);
}

export function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}為必填`);
  return trimmed;
}

export function buildInviteUrl(inviteCode: string): string {
  return `${window.location.origin}/join/${inviteCode}`;
}

export function formatDate(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "";
  const date = (value as { toDate: () => Date }).toDate();
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
