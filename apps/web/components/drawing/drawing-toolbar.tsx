"use client";

import styles from "./drawing-viewer.module.css";

type DrawingToolbarProps = {
  disabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  roomsLayer?: { visible: boolean; toggle: () => void };
  devicesLayer?: { visible: boolean; toggle: () => void };
  roomLabels?: { visible: boolean; toggle: () => void };
};

export function DrawingToolbar({ disabled, onZoomIn, onZoomOut, onFit, roomsLayer, devicesLayer, roomLabels }: DrawingToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Керування кресленням">
      <button type="button" disabled={disabled} onClick={onZoomIn} aria-label="Збільшити масштаб">
        +
      </button>
      <button type="button" disabled={disabled} onClick={onZoomOut} aria-label="Зменшити масштаб">
        −
      </button>
      <button type="button" disabled={disabled} onClick={onFit}>
        Вмістити все
      </button>
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
      <span className={styles.hint}>Перетягуйте план мишею; колесо змінює масштаб.</span>
      {roomLabels && (
        <button type="button" disabled={disabled} aria-pressed={roomLabels.visible}
          onClick={roomLabels.toggle} title="Назви та площі поверх плану. Вимкніть, якщо DXF уже містить написи.">
          Підписи
        </button>
      )}
    </div>
  );
}
