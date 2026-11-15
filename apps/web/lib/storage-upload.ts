/**
 * Direct browser-to-Supabase Storage signed upload implementation.
 * Uploads binary file bytes via HTTP PUT using the signed upload URL.
 * Does not expose or log signed URLs or security tokens.
 */

export function getFullSignedUploadUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") || "";
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

export type StorageUploadProgressCallback = (
  percent: number,
  loadedBytes: number,
  totalBytes: number,
) => void;

export type UploadFileToSignedUrlOptions = {
  url: string;
  file: File | Blob;
  onProgress?: StorageUploadProgressCallback;
  signal?: AbortSignal;
};

export class StorageUploadError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "StorageUploadError";
    this.statusCode = statusCode;
  }
}

export function uploadFileToSignedUrl({
  url,
  file,
  onProgress,
  signal,
}: UploadFileToSignedUrlOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }

    const targetUrl = getFullSignedUploadUrl(url);
    const xhr = new XMLHttpRequest();

    const handleAbort = () => {
      xhr.abort();
      reject(new DOMException("Upload aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent, event.loaded, event.total);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) {
          onProgress(100, file.size, file.size);
        }
        resolve();
      } else {
        let errorMessage = `Не вдалося завантажити файл у сховище (HTTP ${xhr.status}).`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed?.message && typeof parsed.message === "string") {
            errorMessage = `Помилка сховища: ${parsed.message}`;
          } else if (parsed?.error && typeof parsed.error === "string") {
            errorMessage = `Помилка сховища: ${parsed.error}`;
          }
        } catch {
          // Keep generic message if response body is not JSON
        }
        reject(new StorageUploadError(errorMessage, xhr.status));
      }
    });

    xhr.addEventListener("error", () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      reject(
        new StorageUploadError(
          "Мережева помилка під час передачі файлу у сховище. Перевірте підключення до інтернету.",
        ),
      );
    });

    xhr.addEventListener("abort", () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      reject(new DOMException("Upload aborted", "AbortError"));
    });

    xhr.open("PUT", targetUrl);
    // DXF files usually have application/dxf or application/octet-stream
    xhr.setRequestHeader("Content-Type", file.type || "application/dxf");
    xhr.send(file);
  });
}
