"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type ErrorToast = {
  id: number;
  message: string;
};

type ErrorToastContextValue = {
  showErrorToast: (message: string) => void;
};

const ErrorToastContext = createContext<ErrorToastContextValue | null>(null);

export function ErrorToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ErrorToast[]>([]);
  const nextId = useRef(0);

  const showErrorToast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ showErrorToast }), [showErrorToast]);

  return (
    <ErrorToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Повідомлення про помилки"
        className="pointer-events-none fixed inset-x-[var(--bim-spacing-4)] bottom-[var(--bim-spacing-4)] z-50 flex max-h-[calc(100dvh-var(--bim-spacing-8))] flex-col items-end gap-[var(--bim-spacing-3)] overflow-y-auto sm:inset-x-auto sm:right-[var(--bim-spacing-6)] sm:w-full sm:max-w-sm"
      >
        {toasts.map(({ id, message }) => (
          <div
            key={id}
            role="alert"
            className="pointer-events-auto flex w-full min-w-0 shrink-0 items-start gap-[var(--bim-spacing-3)] rounded-[var(--bim-radius-lg)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-[var(--bim-spacing-4)] text-[var(--bim-color-semantic-error)] shadow-[var(--bim-shadow-md)]"
          >
            <p className="min-w-0 flex-1 break-words text-sm">{message}</p>
            <button
              type="button"
              onClick={() => dismissToast(id)}
              aria-label="Закрити повідомлення про помилку"
              className="min-h-[var(--bim-size-interactive-target-min)] shrink-0 rounded-[var(--bim-radius-sm)] px-[var(--bim-spacing-2)] text-sm font-medium hover:bg-[var(--bim-color-surface-default)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
            >
              Закрити
            </button>
          </div>
        ))}
      </div>
    </ErrorToastContext.Provider>
  );
}

export function useErrorToast(): ErrorToastContextValue {
  const context = useContext(ErrorToastContext);

  if (!context) {
    throw new Error("useErrorToast must be used within ErrorToastProvider");
  }

  return context;
}
