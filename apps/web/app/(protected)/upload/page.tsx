import { EmptyState } from "@/components/ui/empty-state";

export default function UploadPage() {
  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <h1 className="text-2xl font-semibold">Завантаження креслень</h1>
      <EmptyState
        title="Креслення не вибрано"
        description="Поки що немає вибраного креслення. Завантаження DXF-креслень стане доступним згодом."
      />
    </div>
  );
}
