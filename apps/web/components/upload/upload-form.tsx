"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import type { RequestedDrawingUnits } from "@bim/contracts";
import { useErrorToast } from "@/components/ui/error-toast-provider";
import {
  createDrawing,
  ApiAuthenticationError,
  ApiConfigurationError,
  ApiHttpError,
} from "@/lib/api";
import { uploadFileToSignedUrl, StorageUploadError } from "@/lib/storage-upload";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MiB (52,428,800 bytes)

type UploadStep = "idle" | "creating" | "uploading" | "success" | "error";

type CachedDrawingUpload = {
  drawingId: string;
  uploadUrl: string;
  path: string;
  fileName: string;
  fileSize: number;
  units: RequestedDrawingUnits;
  expiresAt: number;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 Б";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function validateDxfFile(file: File): string | null {
  if (!/\.dxf$/i.test(file.name)) {
    return "Непідтримуваний формат файлу. Будь ласка, виберіть файл із розширенням .dxf.";
  }
  if (file.size === 0) {
    return "Вибраний файл порожній (0 байтів). Будь ласка, виберіть коректний DXF-файл.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Розмір файлу (${formatBytes(file.size)}) перевищує максимально допустимі 50 МіБ.`;
  }
  return null;
}

export function UploadForm() {
  const router = useRouter();
  const { showErrorToast } = useErrorToast();

  const [file, setFile] = useState<File | null>(null);
  const [units, setUnits] = useState<RequestedDrawingUnits>("mm");
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [loadedBytes, setLoadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [cachedUpload, setCachedUpload] = useState<CachedDrawingUpload | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isBusy = step === "creating" || step === "uploading" || step === "success";

  // Clean up any ongoing upload on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSelectFile = useCallback((selectedFile: File) => {
    const validationError = validateDxfFile(selectedFile);
    if (validationError) {
      setErrorMessage(validationError);
      showErrorToast(validationError);
      return;
    }

    setErrorMessage(null);
    setFile(selectedFile);
    setCachedUpload(null);
    setStep("idle");
    setProgress(0);
    setLoadedBytes(0);
    setTotalBytes(selectedFile.size);
  }, [showErrorToast]);

  const handleRemoveFile = useCallback(() => {
    if (isBusy) return;
    setFile(null);
    setErrorMessage(null);
    setCachedUpload(null);
    setStep("idle");
    setProgress(0);
    setLoadedBytes(0);
    setTotalBytes(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [isBusy]);

  const handleUnitsChange = (newUnits: RequestedDrawingUnits) => {
    if (isBusy) return;
    setUnits(newUnits);
    // Invalidate cached upload if units change because drawing metadata depends on units
    setCachedUpload(null);
  };

  // Drag-and-drop event handlers
  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isBusy) return;
    dragCounterRef.current += 1;
    if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isBusy) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isBusy) return;
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isBusy) return;
    dragCounterRef.current = 0;
    setIsDragging(false);

    const droppedFiles = event.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    if (droppedFiles.length > 1) {
      const msg = "Будь ласка, перетягніть лише один файл за раз.";
      setErrorMessage(msg);
      showErrorToast(msg);
      return;
    }

    handleSelectFile(droppedFiles[0]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isBusy) return;

    if (!file) {
      const msg = "Будь ласка, виберіть DXF-файл для завантаження.";
      setErrorMessage(msg);
      showErrorToast(msg);
      return;
    }

    const validationError = validateDxfFile(file);
    if (validationError) {
      setErrorMessage(validationError);
      showErrorToast(validationError);
      return;
    }

    setErrorMessage(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let targetDrawingId: string;
      let targetUploadUrl: string;

      // Safe retry: check if an existing drawing record and signed URL can be reused
      const now = Date.now();
      const canReuseUpload =
        cachedUpload &&
        cachedUpload.fileName === file.name &&
        cachedUpload.fileSize === file.size &&
        cachedUpload.units === units &&
        cachedUpload.expiresAt > now + 60_000; // at least 1 minute remaining

      if (canReuseUpload) {
        targetDrawingId = cachedUpload.drawingId;
        targetUploadUrl = cachedUpload.uploadUrl;
      } else {
        // Step 1: Create drawing record via authenticated API boundary
        // Sends ONLY the fields accepted by FastAPI: original_file_name and units.
        setStep("creating");
        setProgress(0);
        setLoadedBytes(0);
        setTotalBytes(file.size);

        const response = await createDrawing(
          {
            fileName: file.name,
            units,
          },
          abortController.signal,
        );

        targetDrawingId = response.drawing.id;
        targetUploadUrl = response.upload.url;

        if (!targetDrawingId || !targetUploadUrl) {
          throw new Error("Сервер повернув некоректні дані для завантаження файлу.");
        }

        setCachedUpload({
          drawingId: targetDrawingId,
          uploadUrl: targetUploadUrl,
          path: response.upload.path,
          fileName: file.name,
          fileSize: file.size,
          units,
          expiresAt: Date.now() + response.upload.expiresInSeconds * 1000,
        });
      }

      // Step 2: Upload selected file bytes directly from browser to Supabase Storage
      setStep("uploading");

      await uploadFileToSignedUrl({
        url: targetUploadUrl,
        file,
        signal: abortController.signal,
        onProgress: (pct, loaded, total) => {
          setProgress(pct);
          setLoadedBytes(loaded);
          setTotalBytes(total);
        },
      });

      // Step 3: Success -> navigate to /drawings/[id]
      setStep("success");
      setCachedUpload(null);
      router.push(`/drawings/${targetDrawingId}`);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      setStep("error");
      let message = "Під час завантаження сталася помилка. Спробуйте знову.";

      if (err instanceof ApiAuthenticationError) {
        message = "Для завантаження креслення необхідно увійти в систему.";
      } else if (err instanceof ApiConfigurationError) {
        message = "Помилка конфігурації API. Будь ласка, зверніться до адміністратора.";
      } else if (err instanceof ApiHttpError) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          message = "Необхідно увійти в систему для завантаження креслення.";
        } else if (err.statusCode === 422) {
          message = `Помилка валідації параметрів креслення: ${err.detail || "перевірте коректність файлу"}.`;
        } else {
          message = err.detail
            ? `Не вдалося створити запис креслення: ${err.detail}`
            : "Не вдалося зареєструвати креслення на сервері. Будь ласка, спробуйте знову.";
        }
      } else if (err instanceof StorageUploadError) {
        message = err.message;
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }

      setErrorMessage(message);
      showErrorToast(message);
    } finally {
      abortControllerRef.current = null;
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-[var(--bim-spacing-6)]"
      aria-busy={isBusy}
    >
      {/* Upload card / dropzone */}
      <section
        aria-label="Вибір DXF-файлу"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-[var(--bim-spacing-6)] sm:p-[var(--bim-spacing-8)] shadow-[var(--bim-shadow-sm)]"
      >
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`flex min-h-56 flex-col items-center justify-center rounded-[var(--bim-radius-lg)] border-2 border-dashed p-[var(--bim-spacing-6)] text-center transition-colors ${
            isDragging
              ? "border-[var(--bim-color-brand-primary)] bg-[var(--bim-color-brand-primary-subtle)]"
              : file
                ? "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)]"
                : "border-[var(--bim-color-border-strong)] bg-[var(--bim-color-surface-subtle)] hover:border-[var(--bim-color-brand-primary)]"
          }`}
        >
          {file ? (
            <div className="flex w-full max-w-md flex-col items-center gap-[var(--bim-spacing-3)]">
              <div className="flex size-14 items-center justify-center rounded-[var(--bim-radius-full)] bg-[var(--bim-color-brand-primary-subtle)] text-[var(--bim-color-brand-primary)]">
                <FileText className="size-7" aria-hidden="true" />
              </div>

              <div className="min-w-0 text-center">
                <p className="break-all font-semibold text-[var(--bim-color-text-primary)]">
                  {file.name}
                </p>
                <p className="mt-1 text-sm text-[var(--bim-color-text-secondary)]">
                  Розмір: {formatBytes(file.size)}
                </p>
              </div>

              <div className="mt-[var(--bim-spacing-2)] flex flex-wrap justify-center gap-[var(--bim-spacing-2)]">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[var(--bim-size-control-md)] rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  Змінити файл
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleRemoveFile}
                  aria-label="Видалити вибраний файл"
                  className="inline-flex min-h-[var(--bim-size-control-md)] items-center gap-1.5 rounded-[var(--bim-radius-md)] border border-[var(--bim-color-border-default)] px-[var(--bim-spacing-3)] text-sm font-medium text-[var(--bim-color-text-secondary)] hover:bg-[var(--bim-color-surface-default)] hover:text-[var(--bim-color-semantic-error)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  <X className="size-4" aria-hidden="true" />
                  Видалити
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-[var(--bim-spacing-3)]">
              <div className="flex size-14 items-center justify-center rounded-[var(--bim-radius-full)] bg-[var(--bim-color-surface-default)] text-[var(--bim-color-text-secondary)] shadow-[var(--bim-shadow-sm)]">
                <Upload className="size-7" aria-hidden="true" />
              </div>

              <div>
                <p className="text-base font-semibold text-[var(--bim-color-text-primary)]">
                  {isDragging
                    ? "Відпустіть файл для завантаження"
                    : "Перетягніть DXF-файл сюди"}
                </p>
                <p className="mt-1 text-sm text-[var(--bim-color-text-secondary)]">
                  або скористайтеся кнопкою огляду
                </p>
              </div>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="mt-[var(--bim-spacing-2)] min-h-[var(--bim-size-control-md)] rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Вибрати DXF-файл
              </button>

              <p className="mt-[var(--bim-spacing-1)] text-xs text-[var(--bim-color-text-secondary)]">
                Підтримується лише формат .dxf (максимальний розмір 50 МіБ)
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf,application/dxf,application/x-dxf"
            className="hidden"
            disabled={isBusy}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (selected) {
                handleSelectFile(selected);
              }
            }}
          />
        </div>

        {/* Units selection */}
        <fieldset
          className="mt-[var(--bim-spacing-6)] border-t border-[var(--bim-color-border-default)] pt-[var(--bim-spacing-6)]"
          disabled={isBusy}
        >
          <legend className="text-sm font-semibold text-[var(--bim-color-text-primary)]">
            Одиниці виміру координат креслення
          </legend>
          <p className="mt-1 text-xs text-[var(--bim-color-text-secondary)]">
            Вкажіть одиниці виміру або залиште автовизначення із заголовка DXF ($INSUNITS).
          </p>

          <div className="mt-[var(--bim-spacing-4)] grid gap-[var(--bim-spacing-3)] sm:grid-cols-3">
            <label
              className={`flex cursor-pointer items-start gap-[var(--bim-spacing-3)] rounded-[var(--bim-radius-md)] border p-[var(--bim-spacing-3)] transition-colors ${
                units === "mm"
                  ? "border-[var(--bim-color-brand-primary)] bg-[var(--bim-color-brand-primary-subtle)]"
                  : "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] hover:bg-[var(--bim-color-surface-subtle)]"
              } ${isBusy ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="drawing-units"
                value="mm"
                checked={units === "mm"}
                disabled={isBusy}
                onChange={() => handleUnitsChange("mm")}
                className="mt-0.5 size-4 text-[var(--bim-color-brand-primary)] focus:ring-[var(--bim-color-border-focus)]"
              />
              <div className="text-xs">
                <span className="font-medium text-[var(--bim-color-text-primary)]">
                  Міліметри (мм)
                </span>
                <p className="mt-0.5 text-[var(--bim-color-text-secondary)]">
                  Типовий стандарт архітектурних планів
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-[var(--bim-spacing-3)] rounded-[var(--bim-radius-md)] border p-[var(--bim-spacing-3)] transition-colors ${
                units === "m"
                  ? "border-[var(--bim-color-brand-primary)] bg-[var(--bim-color-brand-primary-subtle)]"
                  : "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] hover:bg-[var(--bim-color-surface-subtle)]"
              } ${isBusy ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="drawing-units"
                value="m"
                checked={units === "m"}
                disabled={isBusy}
                onChange={() => handleUnitsChange("m")}
                className="mt-0.5 size-4 text-[var(--bim-color-brand-primary)] focus:ring-[var(--bim-color-border-focus)]"
              />
              <div className="text-xs">
                <span className="font-medium text-[var(--bim-color-text-primary)]">
                  Метри (м)
                </span>
                <p className="mt-0.5 text-[var(--bim-color-text-secondary)]">
                  Для креслень у метричних одиницях
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-[var(--bim-spacing-3)] rounded-[var(--bim-radius-md)] border p-[var(--bim-spacing-3)] transition-colors ${
                units === "from_file"
                  ? "border-[var(--bim-color-brand-primary)] bg-[var(--bim-color-brand-primary-subtle)]"
                  : "border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] hover:bg-[var(--bim-color-surface-subtle)]"
              } ${isBusy ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="drawing-units"
                value="from_file"
                checked={units === "from_file"}
                disabled={isBusy}
                onChange={() => handleUnitsChange("from_file")}
                className="mt-0.5 size-4 text-[var(--bim-color-brand-primary)] focus:ring-[var(--bim-color-border-focus)]"
              />
              <div className="text-xs">
                <span className="font-medium text-[var(--bim-color-text-primary)]">
                  З файлу DXF
                </span>
                <p className="mt-0.5 text-[var(--bim-color-text-secondary)]">
                  Визначити автоматично при розпізнаванні
                </p>
              </div>
            </label>
          </div>
        </fieldset>

        {/* Real progress display */}
        {isBusy && (
          <div
            className="mt-[var(--bim-spacing-6)] rounded-[var(--bim-radius-lg)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] p-[var(--bim-spacing-4)]"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-xs font-medium text-[var(--bim-color-text-primary)]">
              <span className="inline-flex items-center gap-2">
                {step === "success" ? (
                  <CheckCircle2
                    className="size-4 text-[var(--bim-color-semantic-success)]"
                    aria-hidden="true"
                  />
                ) : (
                  <Loader2
                    className="size-4 animate-spin text-[var(--bim-color-brand-primary)]"
                    aria-hidden="true"
                  />
                )}
                {step === "creating" && "Створення запису креслення..."}
                {step === "uploading" && `Завантаження у сховище: ${progress}%`}
                {step === "success" && "Файл завантажено. Перехід до перегляду..."}
              </span>
              <span className="text-[var(--bim-color-text-secondary)]">
                {step === "uploading" && totalBytes > 0
                  ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
                  : null}
              </span>
            </div>

            <div className="mt-[var(--bim-spacing-2)] h-2.5 w-full overflow-hidden rounded-full bg-[var(--bim-color-border-default)]">
              <div
                role="progressbar"
                aria-valuenow={step === "creating" ? 10 : progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className={`h-full transition-all duration-150 ${
                  step === "success"
                    ? "bg-[var(--bim-color-semantic-success)]"
                    : "bg-[var(--bim-color-brand-primary)]"
                } ${step === "creating" ? "w-1/12 animate-pulse" : ""}`}
                style={{
                  width: step === "creating" ? "15%" : `${progress}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error message alert */}
        {errorMessage && (
          <div
            role="alert"
            className="mt-[var(--bim-spacing-4)] flex items-start gap-[var(--bim-spacing-3)] rounded-[var(--bim-radius-lg)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-[var(--bim-spacing-4)] text-[var(--bim-color-semantic-error)]"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm break-words">
              <p className="font-semibold">Помилка завантаження</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Action submit button */}
        <div className="mt-[var(--bim-spacing-6)] flex flex-wrap items-center justify-end gap-[var(--bim-spacing-3)]">
          <button
            type="submit"
            disabled={!file || isBusy}
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary)] px-[var(--bim-spacing-6)] text-sm font-medium text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {step === "creating" && (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Створення...
              </>
            )}
            {step === "uploading" && (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Завантаження ({progress}%)...
              </>
            )}
            {step === "success" && (
              <>
                <CheckCircle2 className="mr-2 size-4" aria-hidden="true" />
                Успішно
              </>
            )}
            {step === "error" && "Спробувати знову"}
            {step === "idle" && "Завантажити креслення"}
          </button>
        </div>
      </section>
    </form>
  );
}
