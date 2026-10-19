import type { Drawing } from "@bim/contracts";
import { ProjectStatus } from "@/components/project-status";

const initialDrawing: Pick<Drawing, "status"> = {
  status: "uploaded",
};

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3 border-b pb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
          Інтелектуальна BIM-система
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Робочий простір інженера
        </h1>
        <p className="max-w-2xl text-slate-600">
          Каркас застосунку готовий до підключення завантаження DXF, API та перегляду плану.
        </p>
      </header>

      <ProjectStatus initialStatus={initialDrawing.status} />
    </main>
  );
}
