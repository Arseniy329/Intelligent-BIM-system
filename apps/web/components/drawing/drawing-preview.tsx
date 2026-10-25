"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { DrawingViewer } from "./drawing-viewer";

type LocalDrawing = { url: string; name: string };

export function DrawingPreview() {
  const [drawing, setDrawing] = useState<LocalDrawing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const openFile = useCallback((file: File) => {
    if (!/\.dxf$/i.test(file.name)) {
      setError("Непідтримуваний формат. Виберіть файл із розширенням .dxf.");
      return;
    }
    if (file.size === 0) {
      setError("DXF-файл порожній. Виберіть інший файл.");
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      // Own URLs in a ref: even replacements batched before a React effect are released.
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setError(null);
      setDrawing({ url, name: file.name });
    } catch {
      setError("Не вдалося відкрити локальний файл. Спробуйте вибрати його знову.");
    }
  }, []);

  const closeDrawing = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setDrawing(null);
  };

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const reset = () => { depth = 0; setDragging(false); };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      // Prevent browser navigation for file drops anywhere, including over the viewer.
      if (!hasFiles(event) && !event.dataTransfer?.files.length) return;
      event.preventDefault();
      reset();
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length !== 1) {
        setError("Перетягніть один DXF-файл за раз.");
        return;
      }
      openFile(files[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [openFile]);

  return (
    <div className="min-w-0 space-y-[var(--bim-spacing-5)] text-[var(--bim-color-text-primary)]">
      <h1 className="text-2xl font-semibold">Перевірка DrawingViewer · BIM-59</h1>
      <p>Перетягніть локальний DXF на сторінку або виберіть файл. Файл відкривається у браузері й не надсилається на сервер.</p>
      <section
        aria-label="Відкриття DXF-креслення"
        className={`flex min-h-52 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-[var(--bim-color-brand-primary)] bg-[var(--bim-color-brand-primary-subtle)]"
            : "border-[var(--bim-color-border-strong)] bg-[var(--bim-color-surface-subtle)]"
        }`}
      >
        <Upload aria-hidden="true" className="size-8" />
        <p className="font-semibold" role="status">
          {dragging ? "Відпустіть файл, щоб відкрити креслення" : "Перетягніть DXF-креслення сюди"}
        </p>
        <p>або виберіть файл із комп’ютера</p>
        <input
          ref={inputRef}
          type="file"
          accept=".dxf"
          className="hidden"
          aria-label="Вибрати DXF"
          aria-describedby="drawing-preview-help"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) openFile(file);
          }}
        />
        <button
          type="button"
          className="min-h-10 rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-4 font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
          aria-describedby="drawing-preview-help"
          onClick={() => inputRef.current?.click()}
        >
          Вибрати DXF
        </button>
        <p className="text-sm text-[var(--bim-color-text-secondary)]">Підтримуваний формат: .dxf</p>
      </section>
      <p id="drawing-preview-help" className="break-words text-sm text-[var(--bim-color-text-secondary)]">
        Тестові файли: apps/api/tests/fixtures/test_drawing_dxf/.
        {" "}TEXT/MTEXT: apps/web/tests/fixtures/dxf/04_ukrainian_text.dxf.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-3 text-[var(--bim-color-semantic-error)]"
        >
          {error}
        </p>
      )}
      {drawing ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="break-all">{drawing.name}</p>
            <button
              type="button"
              className="min-h-10 rounded-lg border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-3 text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
              onClick={closeDrawing}
            >
              Закрити креслення
            </button>
          </div>
          <DrawingViewer url={drawing.url} fileName={drawing.name} />
        </>
      ) : <p role="status">Виберіть файл, щоб відкрити креслення.</p>}
    </div>
  );
}
