import { UploadForm } from "@/components/upload/upload-form";

export default function UploadPage() {
  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
          Завантаження креслень
        </h1>
        <p className="mt-[var(--bim-spacing-2)] text-sm text-[var(--bim-color-text-secondary)]">
          Виберіть DXF-креслення для аналізу та подальшого розміщення пожежних пристроїв.
        </p>
      </div>

      <UploadForm />
    </div>
  );
}
