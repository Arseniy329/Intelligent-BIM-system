"use client";

import styles from "./drawing-viewer.module.css";

type DrawingToolbarProps = {
  disabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
};

export function DrawingToolbar({ disabled, onZoomIn, onZoomOut, onFit }: DrawingToolbarProps) {
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
      <span className={styles.hint}>Перетягуйте план мишею; колесо змінює масштаб.</span>
    </div>
  );
}
