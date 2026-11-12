import Link from "next/link";
import { DrawingsList } from "@/components/drawings/drawings-list";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";

export default function DrawingsPage() {
  return (
    <PageContainer className="space-y-[var(--bim-spacing-6)] py-[var(--bim-spacing-6)]">
      <div className="flex flex-col gap-[var(--bim-spacing-4)] sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
          Мої креслення
        </h1>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/upload">Завантажити DXF</Link>
        </Button>
      </div>

      <DrawingsList />
    </PageContainer>
  );
}
