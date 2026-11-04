"use client";

import dynamic from "next/dynamic";
import type { Device, Room } from "@bim/contracts";
import { useState, type CSSProperties } from "react";
import type { DrawingViewportController } from "@/lib/drawing/viewer-adapter";
import tokens from "../../../../tokens.json";
import styles from "./drawing-viewer.module.css";

export type DrawingViewerProps = {
  /** A local object URL or an already obtained signed read URL; no API field is assumed. */
  url: string;
  fileName?: string;
  rooms?: Room[];
  devices?: Device[];
  /** Disable initially for plans with their own room annotations; the toolbar can restore them. */
  initialRoomLabelsVisible?: boolean;
  onReady?: (controller: DrawingViewportController | null) => void;
  /** Remote owners can renew a signed URL; local/demo viewers simply reopen their file. */
  onRetry?: () => void;
  retryPending?: boolean;
};

const DrawingCanvas = dynamic(() => import("./drawing-canvas"), {
  ssr: false,
  loading: () => <p role="status">Завантаження переглядача…</p>,
});

const viewerTheme = {
  "--viewer-border": tokens.color.border.default,
  "--viewer-control-border": tokens.color.neutral["300"],
  "--viewer-text": tokens.color.text.primary,
  "--viewer-muted": tokens.color.text.secondary,
  "--viewer-surface": tokens.color.surface.default,
  "--viewer-background": tokens.color.plan.background,
  "--viewer-hover": tokens.color.surface.subtle,
  "--viewer-focus": tokens.color.border.focus,
} as CSSProperties;

export function DrawingViewer(props: DrawingViewerProps) {
  const [attempt, setAttempt] = useState(0);

  return (
    <section className={styles.viewer} style={viewerTheme} aria-label={props.fileName ?? "DXF-креслення"}>
      <DrawingCanvas
        key={`${props.url}:${attempt}`}
        {...props}
        onRetry={props.onRetry ?? (() => setAttempt((value) => value + 1))}
      />
    </section>
  );
}
