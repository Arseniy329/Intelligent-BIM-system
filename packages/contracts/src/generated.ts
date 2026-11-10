/* Generated from schemas/contracts.schema.json. Do not edit manually. */

/**
 * Фактичні одиниці координат DXF після визначення API
 */
export type DrawingUnits = "mm" | "m";
export type DrawingStatus = "pending" | "uploaded" | "processing" | "processed" | "error";
export type DrawingDetailStatus = "pending" | "uploaded" | "processing" | "processed" | "failed";
/**
 * Новий контур у координатах DXF. Перша точка наприкінці масиву не повторюється; полігон має бути коректним (без самоперетинів). Площу перераховує API.
 *
 * @minItems 3
 */
export type RoomPolygon = [Point, Point, Point, ...Point[]];
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
  roomType?: RoomType;
  roomUpdateRequest?: RoomUpdateRequest;
  roomCreateRequest?: RoomCreateRequest;
  device?: Device;
  deviceCreateRequest?: DeviceCreateRequest;
  deviceUpdateRequest?: DeviceUpdateRequest;
  createDrawingRequest?: CreateDrawingRequest;
  createDrawingResponse?: CreateDrawingResponse;
  drawingResult?: DrawingResult;
  processingJob?: ProcessingJob;
  rule?: Rule;
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
/**
 * Приміщення креслення. source — походження контуру (fire_rooms — з шару FIRE_ROOMS, manual — накреслено вручну); confirmed — інженер підтвердив контур.
 */
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
  source?: "auto" | "fire_rooms" | "manual";
  confirmed?: boolean;
}
/**
 * Координата у двовимірній світовій системі DXF (WCS): початок (0, 0), +X праворуч, +Y вгору. Значення передаються без масштабування в одиницях Drawing.resolvedUnits; перетворення для Canvas/SVG виконує лише клієнт.
 */
export interface Point {
  x: number;
  y: number;
}
/**
 * Запис довідника типів приміщень. GET /room-types повертає масив цих записів; Room.type містить code. Код unknown означає «Тип не визначено».
 */
export interface RoomType {
  code: string;
  name: string;
  /**
   * Приклади назв приміщень на кресленні, за якими пропонується тип
   */
  examples: string[];
}
/**
 * Тіло PATCH /rooms/{id}. Потрібне хоча б одне поле. type — лише code з GET /room-types; height — у метрах, null очищає висоту; polygon — новий контур, площу перераховує API; confirmed — підтвердження контуру.
 */
export interface RoomUpdateRequest {
  type?: string;
  height?: number | null;
  polygon?: RoomPolygon;
  confirmed?: boolean;
}
/**
 * Тіло POST /drawings/{id}/rooms — приміщення, накреслене вручну (source=manual, confirmed=true). Якщо type не задано, API пропонує його за name.
 */
export interface RoomCreateRequest {
  name?: string | null;
  type?: string;
  height?: number | null;
  polygon: RoomPolygon;
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
/**
 * Тіло POST /drawings/{id}/devices — пристрій, доданий вручну. Шар завжди SYS_FIRE_SENSORS. roomId — приміщення того самого креслення або null.
 */
export interface DeviceCreateRequest {
  type: "smoke_detector" | "heat_detector" | "sounder" | "manual_call_point";
  position: Point;
  roomId?: string | null;
}
/**
 * Тіло PATCH /devices/{id}. Потрібне хоча б одне поле. roomId: null відв'язує пристрій від приміщення.
 */
export interface DeviceUpdateRequest {
  type?: "smoke_detector" | "heat_detector" | "sounder" | "manual_call_point";
  position?: Point;
  roomId?: string | null;
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
  /**
   * Тимчасове посилання на оригінальний DXF для підкладки оверлею
   */
  sourceDownloadUrl?: string | null;
  /**
   * Час завершення дії sourceDownloadUrl
   */
  sourceDownloadUrlExpiresAt?: string | null;
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
export interface Rule {
  /**
   * Збігається з Finding.ruleId.
   */
  id: string;
  ruleId: string;
  name: string;
  deviceType: "smoke_detector" | "heat_detector" | "sounder" | "manual_call_point";
  roomTypes: string[];
  minHeightM: number | null;
  maxHeightM: number | null;
  value: number;
  valueKind:
    | "max_grid_spacing_m"
    | "max_protected_area_m2"
    | "max_wall_distance_m"
    | "min_wall_clearance_m"
    | "min_sound_level_dba";
  document: string | null;
  /**
   * Не вигадувати пункт, якщо його не звірено.
   */
  clause: string | null;
  sourceUrl: string | null;
  verificationStatus: "verified" | "needs_review";
}
