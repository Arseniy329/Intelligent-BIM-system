/* Generated from schemas/contracts.schema.json. Do not edit manually. */

export type DrawingUnits = "mm" | "m" | "from_file";
export type DrawingStatus = "uploaded" | "processing" | "processed" | "error";

/**
 * Спільні контракти вебклієнта й API
 */
export interface BimContracts {
  drawing?: Drawing;
  room?: Room;
  device?: Device;
  createDrawingRequest?: CreateDrawingRequest;
  createDrawingResponse?: CreateDrawingResponse;
  drawingResult?: DrawingResult;
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
export interface Room {
  id: string;
  drawingId: string;
  name: string | null;
  type: string | null;
  height: number | null;
  area: number;
  /**
   * @minItems 3
   */
  polygon: [Point, Point, Point, ...Point[]];
}
export interface Point {
  x: number;
  y: number;
}
export interface Device {
  id: string;
  drawingId: string;
  roomId: string;
  type: "smoke_detector" | "heat_detector" | "sounder";
  position: Point;
  layer: string;
}
export interface CreateDrawingRequest {
  fileName: string;
  fileSizeBytes: number;
  units: DrawingUnits;
}
export interface CreateDrawingResponse {
  drawing: Drawing;
  upload: SignedUpload;
}
export interface SignedUpload {
  url: string;
  path: string;
  expiresInSeconds: number;
}
export interface DrawingResult {
  drawing: Drawing;
  rooms: Room[];
  devices: Device[];
}
