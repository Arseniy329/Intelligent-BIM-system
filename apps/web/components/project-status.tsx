"use client";

import { Button } from "@/components/ui/button";
import { useDrawingStore } from "@/store/use-drawing-store";

export function ProjectStatus({ initialStatus }: { initialStatus: string }) {
  const selectedRoomId = useDrawingStore((state) => state.selectedRoomId);
  const selectRoom = useDrawingStore((state) => state.selectRoom);

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Каркас монорепозиторію</h2>
          <p className="mt-2 text-sm text-slate-600">
            Статус тестового креслення: <strong>{initialStatus}</strong>. Zustand готовий синхронізувати вибір між таблицями та DrawingViewer.
          </p>
          {selectedRoomId && (
            <p className="mt-2 text-sm text-blue-700">Обрана кімната: {selectedRoomId}</p>
          )}
        </div>
        <Button onClick={() => selectRoom(selectedRoomId ? null : "room-demo-01")}>
          {selectedRoomId ? "Скинути вибір" : "Перевірити стан"}
        </Button>
      </div>
    </section>
  );
}
