"use client";

import styles from "./drawing-viewer.module.css";

type DrawingToolbarProps = {
  mode?: "rooms" | "devices";
  onModeChange?: (mode: "rooms" | "devices") => void;
  modeDisabled?: boolean;
  zoomPercent?: number;
  disabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  roomsLayer?: { visible: boolean; toggle: () => void };
  devicesLayer?: { visible: boolean; toggle: () => void };
  roomLabels?: { visible: boolean; toggle: () => void };
};

export function DrawingToolbar({ disabled, onZoomIn, onZoomOut, onFit, roomsLayer, devicesLayer, roomLabels, zoomPercent = 100, mode, onModeChange, modeDisabled }: DrawingToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Керування кресленням">
      <div className={styles.toolbarTitle}><strong>Архітектурний план</strong><span>Натисніть на {mode === "devices" ? "прилад" : "кімнату"}, щоб побачити деталі</span></div>
      {mode && onModeChange && <div className={styles.modes}>
        <button type="button" disabled={disabled || modeDisabled} aria-pressed={mode === "rooms"} onClick={() => onModeChange("rooms")}>Кімнати</button>
        <button type="button" disabled={disabled || modeDisabled} aria-pressed={mode === "devices"} onClick={() => onModeChange("devices")}>Прилади</button>
      </div>}
      <div className={styles.zoomControls}>
      <button type="button" disabled={disabled} onClick={onZoomIn} aria-label="Збільшити масштаб">
        +
      </button>
      <button type="button" disabled={disabled} onClick={onZoomOut} aria-label="Зменшити масштаб">
        −
      </button>
      <output aria-label="Масштаб">{zoomPercent}%</output>
      <button type="button" disabled={disabled} onClick={onFit} aria-label="Вмістити все" title="Вмістити все">
        ⛶
      </button>
      </div>
      {roomsLayer && (
        <button type="button" disabled={disabled} aria-pressed={roomsLayer.visible} onClick={roomsLayer.toggle}>
          Приміщення
        </button>
      )}
      {devicesLayer && (
        <button type="button" disabled={disabled} aria-pressed={devicesLayer.visible} onClick={devicesLayer.toggle}>
          Сповіщувачі
        </button>
      )}
      {roomLabels && (
        <button type="button" disabled={disabled} aria-pressed={roomLabels.visible}
          onClick={roomLabels.toggle} title="Назви та площі поверх плану. Вимкніть, якщо DXF уже містить написи.">
          Підписи
        </button>
      )}
    </div>
  );
}
