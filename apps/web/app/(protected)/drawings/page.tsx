import type { Metadata } from "next";
import { DrawingsList } from "@/components/drawings/drawings-list";

export const metadata: Metadata = {
  title: "Мої креслення | Інтелектуальна BIM-система",
};

export default function DrawingsPage() {
  return (
    <div className="space-y-[var(--bim-spacing-6)]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--bim-color-text-primary)]">
          Мої креслення
        </h1>
        <p className="mt-[var(--bim-spacing-2)] text-sm text-[var(--bim-color-text-secondary)]">
          Список завантажених DXF-креслень та стан їхньої обробки.
        </p>
      </div>

      <DrawingsList />
    </div>
  );
}
