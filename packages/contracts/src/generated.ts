/* Generated from schemas/contracts.schema.json. Do not edit manually. */

export type DrawingUnits = "mm" | "m" | "from_file";
export type DrawingStatus = "uploaded" | "processing" | "processed" | "error";
export type DrawingDetailStatus = "pending" | "uploaded" | "processing" | "processed" | "failed";

export interface BimContracts {
  drawing?: Drawing;
  drawingDetailResponse?: DrawingDetailResponse;
}
export interface Drawing {
  id: string;
  ownerId: string;
  originalFileName: string;
  storagePath: string;
  resultStoragePath?: string | null;
  units: DrawingUnits;
  status: DrawingStatus;
  errorMessage?: string | null;
  createdAt: string;
}
export interface DrawingDetailResponse {
  id: string;
  ownerId: string;
  originalFileName: string;
  storagePath: string;
  units: string;
  status: DrawingDetailStatus;
  createdAt: string;
  sourceDownloadUrl?: string | null;
  sourceDownloadUrlExpiresAt?: string | null;
}
