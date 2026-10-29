import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default async function DrawingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <div className="flex flex-col gap-[var(--bim-spacing-2)]">
        <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
          Креслення {id}
        </h1>
        <p className="text-sm text-[var(--bim-color-text-secondary)]">
          Сторінка перегляду та аналізу завантаженого креслення.
        </p>
      </div>

      <section
        aria-label="Статус креслення"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-[var(--bim-spacing-6)] sm:p-[var(--bim-spacing-8)] shadow-[var(--bim-shadow-sm)]"
      >
        <div className="flex items-center gap-[var(--bim-spacing-3)]">
          <CheckCircle2
            className="size-6 text-[var(--bim-color-semantic-success)] shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-base font-semibold text-[var(--bim-color-text-primary)]">
              Файл успішно завантажено
            </h2>
            <p className="mt-1 text-sm text-[var(--bim-color-text-secondary)]">
              Ідентифікатор креслення: <code className="font-mono text-xs">{id}</code>
            </p>
          </div>
        </div>

        <div className="mt-[var(--bim-spacing-6)] flex flex-wrap gap-[var(--bim-spacing-3)]">
          <Link
            href="/upload"
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] border border-[var(--bim-color-button-secondary-border)] bg-[var(--bim-color-button-secondary-bg)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-button-secondary-text)] hover:bg-[var(--bim-color-button-secondary-hover-bg)] active:bg-[var(--bim-color-button-secondary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Завантажити інше креслення
          </Link>
          <Link
            href="/drawing-preview"
            className="inline-flex min-h-[var(--bim-size-control-md)] items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary)] px-[var(--bim-spacing-4)] text-sm font-medium text-[var(--bim-color-brand-on-primary)] hover:bg-[var(--bim-color-brand-primary-hover)] active:bg-[var(--bim-color-brand-primary-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] transition-colors"
          >
            Перейти до перегляду (DrawingViewer)
          </Link>
        </div>
      </section>
    </div>
  );
}
