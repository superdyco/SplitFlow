import type { Timestamp } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  nickname: string;
  email: string;
  photoURL: string | null;
  provider: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
