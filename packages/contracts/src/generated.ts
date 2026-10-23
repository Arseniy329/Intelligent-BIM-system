/* Generated from schemas/contracts.schema.json. Do not edit manually. */

/**
 * Фактичні одиниці координат DXF після визначення API
 */
export type DrawingUnits = "mm" | "m";
export type DrawingStatus = "uploaded" | "processing" | "processed" | "error";
export type DrawingDetailStatus = "pending" | "uploaded" | "processing" | "processed" | "failed";
/**
 * Одиниці, задані користувачем, або команда визначити їх із DXF
 */
export type RequestedDrawingUnits = "mm" | "m" | "from_file";
export type ProcessingJobStatus = "queued" | "processing" | "completed" | "failed";

/**
 * Спільні контракти вебклієнта й API
 */
export interface BimContracts {
  drawing?: Drawing;
  drawingDetailResponse?: DrawingDetailResponse;
  room?: Room;
  device?: Device;
  createDrawingRequest?: CreateDrawingRequest;
  createDrawingResponse?: CreateDrawingResponse;
  drawingResult?: DrawingResult;
  processingJob?: ProcessingJob;
}
export interface Drawing {
  id: string;
  ownerId: string;
  originalFileName: string;
  storagePath: string;
  /**
   * Фактичні одиниці координат. null, доки API не прочитає DXF. Якщо одиниці визначити неможливо, status стає error, а errorMessage пояснює причину.
   */
  resolvedUnits: DrawingUnits | null;
  status: DrawingStatus;
  errorMessage?: string | null;
  createdAt: string;
}
export interface DrawingDetailResponse {
  id: string;
  ownerId: string;
  originalFileName: string;
  storagePath: string;
  units: DrawingUnits;
  status: DrawingDetailStatus;
  createdAt: string;
  sourceDownloadUrl?: string | null;
  sourceDownloadUrlExpiresAt?: string | null;
}
export interface Room {
  id: string;
  drawingId: string;
  name: string | null;
  type: string | null;
  /**
   * Висота приміщення в метрах або null, якщо її не визначено
   */
  height: number | null;
  /**
   * Площа приміщення у квадратних метрах
   */
  area: number;
  /**
   * Вершини контуру в координатах DXF. Полігон логічно замкнений; перша точка наприкінці масиву не повторюється.
   *
   * @minItems 3
   */
  polygon: [Point, Point, Point, ...Point[]];
}
/**
 * Координата у двовимірній світовій системі DXF (WCS): початок (0, 0), +X праворуч, +Y вгору. Значення передаються без масштабування в одиницях Drawing.resolvedUnits; перетворення для Canvas/SVG виконує лише клієнт.
 */
export interface Point {
  x: number;
  y: number;
}
export interface Device {
  id: string;
  drawingId: string;
  /**
   * Ідентифікатор кімнати або null для коридорів і нерозпізнаних зон
   */
  roomId: string | null;
  type: "smoke_detector" | "heat_detector" | "sounder" | "manual_call_point";
  position: Point;
  layer: string;
}
export interface CreateDrawingRequest {
  fileName: string;
  fileSizeBytes: number;
  units: RequestedDrawingUnits;
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
/**
 * Публічний результат обробки. GET /drawings/{id} повертає нове тимчасове посилання; підписаний URL не зберігається в базі.
 */
export interface DrawingResult {
  drawing: Drawing;
  rooms: Room[];
  devices: Device[];
  /**
   * Тимчасове підписане посилання на результат; null, доки результат не готовий
   */
  downloadUrl?: string | null;
  /**
   * Час завершення дії downloadUrl
   */
  downloadUrlExpiresAt?: string | null;
}
/**
 * POST /drawings/{id}/process запускає фонову обробку й повертає цю задачу. Статус перевіряється через GET /processing-jobs/{id}; completed відповідає Drawing.status=processed, після чого клієнт отримує результат через GET /drawings/{drawingId}.
 */
export interface ProcessingJob {
  id: string;
  drawingId: string;
  status: ProcessingJobStatus;
  errorMessage: string | null;
}
