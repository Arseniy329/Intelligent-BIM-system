"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiAuthenticationError, ApiHttpError } from "@/lib/api";
import { listDrawings } from "@/lib/drawing/drawing-api";
import type { DrawingListItem } from "@/lib/drawing/drawing-api";

export interface UseDrawingsResult {
  drawings: DrawingListItem[];
  isLoading: boolean;
  error: string | null;
  isUnauthorized: boolean;
  reload: () => void;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiAuthenticationError ||
    (error instanceof ApiHttpError && error.statusCode === 401);
}

function drawingsErrorMessage(error: unknown): string {
  if (isUnauthorizedError(error)) {
    return "Сеанс завершився. Увійдіть у свій обліковий запис знову.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Не вдалося завантажити список креслень. Спробуйте ще раз.";
}

export function useDrawings(): UseDrawingsResult {
  const [drawings, setDrawings] = useState<DrawingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    listDrawings(controller.signal)
      .then(items => {
        if (!active) return;
        setDrawings(items);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(drawingsErrorMessage(reason));
        setIsUnauthorized(isUnauthorizedError(reason));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setIsUnauthorized(false);
    setReloadToken(token => token + 1);
  }, []);

  return { drawings, isLoading, error, isUnauthorized, reload };
}
