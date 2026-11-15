"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, listDrawings } from "@/lib/api/drawings";
import type { DrawingListItem } from "@/lib/api/drawings";

export interface UseDrawingsResult {
  drawings: DrawingListItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

function drawingsErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
    }
    if (error.status === 404) {
      return "Креслення не знайдено.";
    }
    if (error.status >= 500) {
      return "Помилка сервера. Спробуйте пізніше.";
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Не вдалося завантажити список креслень. Спробуйте ще раз.";
}

const PROCESSING_POLL_INTERVAL_MS = 5000;

function hasActiveProcessing(items: DrawingListItem[]): boolean {
  return items.some((item) => item.status === "processing");
}

function sortByUploadedAtDesc(items: DrawingListItem[]): DrawingListItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      time: Date.parse(item.uploaded_at),
    }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.time);
      const bValid = Number.isFinite(b.time);
      if (aValid && bValid && a.time !== b.time) {
        return b.time - a.time;
      }
      if (aValid !== bValid) {
        return aValid ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function useDrawings(): UseDrawingsResult {
  const [drawings, setDrawings] = useState<DrawingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    listDrawings(controller.signal)
      .then((items) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setDrawings(sortByUploadedAtDesc(items));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(drawingsErrorMessage(reason));
      })
      .finally(() => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [refreshToken]);

  const requestRefresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      requestRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [requestRefresh]);

  const isProcessing = hasActiveProcessing(drawings);

  useEffect(() => {
    if (!isProcessing) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      requestRefresh();
    }, PROCESSING_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isProcessing, requestRefresh]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    requestRefresh();
  }, [requestRefresh]);

  return { drawings, isLoading, error, refresh };
}
