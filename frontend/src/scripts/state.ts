// frontend/src/scripts/state.ts
// Globális kliensoldali állapotkezelő.
import type { InvoiceData, SingleInvoiceResult, ImageInputItem } from '@szamlazo/shared';

export interface UserState {
  id: string;
  email: string;
  credits: number;
  tier?: string;
}

export interface AppState {
  authMode: "login" | "register" | "reset";
  currentUser: UserState | null;
  currentMode: "upload" | "url" | "text";
  selectedFiles: File[];
  inputItemsCache: ImageInputItem[];
  lastProcessedResults: SingleInvoiceResult[];
  activeEditIndex: number;
  currentEditingData: InvoiceData | null;
  invoiceToDeleteDbId: string | null;
  invoiceToDeleteIndex: number | null;
  wasLastPromptVoice: boolean;
  userCompanyName: string | null;
  userCompanyTaxNumber: string | null;
}

export const state: AppState = {
  authMode: "login",
  currentUser: null,
  currentMode: "upload",
  selectedFiles: [],
  inputItemsCache: [],
  lastProcessedResults: [],
  activeEditIndex: -1,
  currentEditingData: null,
  invoiceToDeleteDbId: null,
  invoiceToDeleteIndex: null,
  wasLastPromptVoice: false,
  userCompanyName: null,
  userCompanyTaxNumber: null,
};
