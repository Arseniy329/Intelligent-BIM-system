"use client";

import { useEffect, useRef, useState } from "react";
import type { Device, Point, Room, RoomPolygon } from "@bim/contracts";
import { editApi, type PlanEditApi } from "./edit-api";
import { roomAtPoint, validOutline } from "./edit-geometry";

export type PlanDraft =
  | { kind: "room"; id: string | null; name: string; points: Point[] }
  | { kind: "device"; id: string | null; type: Device["type"]; position: Point | null };

export function usePlanEditor({ drawingId, rooms, refresh, selectRoom, api = editApi }: {
  drawingId: string; rooms: Room[]; devices: Device[];
  refresh: () => Promise<unknown>; selectRoom: (id: string | null) => void; api?: PlanEditApi;
}) {
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [selectedDeviceId, selectDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [deletion, setDeletion] = useState<{ kind: "room" | "device"; id: string } | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  const run = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      setDraft(null); setDeletion(null); setUncertain(false);
      setNotice("Зміни збережено.");
    } catch (cause) {
      // A failed response can follow a committed write (including a DXF 502).
      // Require reconciliation before allowing another non-idempotent request.
      setUncertain(true);
      setError(cause instanceof Error ? `Не вдалося завершити операцію. ${cause.message}. Оновіть дані перед наступною зміною.` : "Не вдалося завершити операцію. Оновіть дані перед наступною зміною.");
    } finally {
      try { await refresh(); } catch { setError("Не вдалося оновити план. Оновіть дані перед наступною зміною."); setUncertain(true); }
      lock.current = false; setBusy(false);
    }
  };
  const begin = (next: PlanDraft) => {
    if (draft || busy || uncertain) return;
    setDraft(next); setError(null); setNotice(null); setDeletion(null);
  };
  const cancel = () => { if (!busy) { setDraft(null); setDeletion(null); setError(null); } };
  const reconcile = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await refresh(); setUncertain(false); setDraft(null); setDeletion(null); setError(null); }
    catch { setError("Оновлення не вдалося. Спробуйте ще раз."); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => {
    if (!draft || busy || uncertain) return;
    if (draft.kind === "room") {
      if (!validOutline(draft.points) || !draft.id && !draft.name.trim()) {
        setError("Вкажіть назву та щонайменше три різні кути без самоперетинів."); return;
      }
      const polygon = draft.points as RoomPolygon;
      void run(async () => {
        const saved = draft.id
          ? await api.updateRoom(draft.id, { polygon, confirmed: false })
          : await api.createRoom(drawingId, { polygon, name: draft.name.trim() });
        selectRoom(saved.id);
      });
    } else {
      if (!draft.position) { setError("Клацніть на плані, щоб указати місце приладу."); return; }
      const body = { type: draft.type, position: draft.position, roomId: roomAtPoint(rooms, draft.position) };
      void run(async () => {
        const saved = draft.id ? await api.updateDevice(draft.id, body) : await api.createDevice(drawingId, body);
        selectDevice(saved.id);
      });
    }
  };
  return {
    draft, busy, error, notice, uncertain, deletion, selectedDeviceId,
    blocked: !!draft || busy || uncertain,
    selectDevice: (id: string) => { if (!draft && !busy) selectDevice(id); },
    beginRoom: (room?: Room) => begin({ kind: "room", id: room?.id ?? null, name: room?.name ?? "", points: room ? [...room.polygon] : [] }),
    beginDevice: (device?: Device) => begin({ kind: "device", id: device?.id ?? null, type: device?.type ?? "smoke_detector", position: device?.position ?? null }),
    setName: (name: string) => setDraft(d => d?.kind === "room" ? { ...d, name } : d),
    setType: (type: Device["type"]) => setDraft(d => d?.kind === "device" ? { ...d, type } : d),
    moveVertex: (index: number, point: Point) => { if (!busy && !uncertain) setDraft(d => d?.kind === "room" ? { ...d, points: d.points.map((p, i) => i === index ? point : p) } : d); },
    setPosition: (position: Point) => { if (!busy && !uncertain) setDraft(d => d?.kind === "device" ? { ...d, position } : d); },
    addPoint: (point: Point) => { if (!busy && !uncertain) setDraft(d => d?.kind === "room" && !d.id ? { ...d, points: [...d.points, point] } : d?.kind === "device" ? { ...d, position: point } : d); },
    undoPoint: () => setDraft(d => d?.kind === "room" ? { ...d, points: d.points.slice(0, -1) } : d),
    requestDelete: (kind: "room" | "device", id: string) => { if (!draft && !busy && !uncertain) setDeletion({ kind, id }); },
    cancelDelete: () => setDeletion(null),
    deleteSelected: () => { if (deletion && !busy && !uncertain) void run(async () => {
      if (deletion.kind === "room") { await api.deleteRoom(deletion.id); selectRoom(null); }
      else { await api.deleteDevice(deletion.id); selectDevice(null); }
    }); },
    confirm: (id: string) => { if (!draft && !busy && !uncertain) void run(() => api.updateRoom(id, { confirmed: true })); },
    confirmAll: () => { if (!draft && !busy && !uncertain) void run(() => api.confirmRooms(drawingId)); },
    regenerate: () => { if (!draft && !busy && !uncertain) void run(() => api.regenerateDevices(drawingId)); },
    save, cancel, reconcile,
  };
}

export type PlanEditor = ReturnType<typeof usePlanEditor>;
