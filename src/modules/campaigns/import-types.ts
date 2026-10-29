export const MAX_SELLER_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_SELLER_IMPORT_ROWS = 500;

export interface SellerSpreadsheetRow {
  line: number;
  displayName: string;
  email: string | null;
  phone: string | null;
  folios: number[];
  errors: string[];
}

export type SellerImportRowStatus = "ready" | "existing" | "error" | "conflict";

export interface SellerImportPreviewRow {
  line: number;
  displayName: string;
  email: string | null;
  phone: string | null;
  folios: number[];
  status: SellerImportRowStatus;
  messages: string[];
}

export interface SellerImportPreview {
  rows: SellerImportPreviewRow[];
  ready: number;
  existing: number;
  errors: number;
  conflicts: number;
}

export interface SellerImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  messages: string[];
}
