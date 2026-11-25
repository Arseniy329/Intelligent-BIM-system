"use client";

import type { Device, Room } from "@bim/contracts";
import type { PlanEditor } from "@/lib/drawing/use-plan-editor";
import { DEVICE_LABELS } from "./device-symbol";

const button = "rounded-lg border px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed";
export function PlanEditorPanel({ editor: e, rooms, devices, selectedRoomId, selectRoom, devicesEditable, disabled }: {
  editor: PlanEditor; rooms: Room[]; devices: Device[]; selectedRoomId: string | null;
  selectRoom: (id: string | null) => void; devicesEditable: boolean; disabled: boolean;
}) {
  const room = rooms.find(r => r.id === selectedRoomId);
  const device = devices.find(d => d.id === e.selectedDeviceId);
  const blocked = disabled || e.blocked;
  return <section aria-label="Редагування плану" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Редагування плану</h2>
    <p className="text-sm">Пунктир — не підтверджено; суцільний контур — підтверджено; фіолетовий — обведено вручну. Джерело і підтвердження незалежні.</p>
    <fieldset disabled={disabled || e.busy} className="space-y-3">
      {!e.draft && <>
        <div className="flex flex-wrap items-center gap-2">
          <label>Приміщення <select aria-label="Вибрати приміщення на плані" value={selectedRoomId ?? ""} disabled={blocked} onChange={event => selectRoom(event.target.value || null)} className={button}>
            <option value="">Виберіть на плані або зі списку</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name || "Без назви"} · {r.confirmed ? "підтверджено" : "не підтверджено"}</option>)}
          </select></label>
          <button className={button} disabled={blocked} onClick={() => e.beginRoom()}>Додати приміщення</button>
          <button className={button} disabled={blocked || !room} onClick={() => e.beginRoom(room)}>Змінити контур</button>
          <button className={button} disabled={blocked || !room || room.confirmed} onClick={() => room && e.confirm(room.id)}>Підтвердити контур</button>
          <button className={button} disabled={blocked || !rooms.some(r => !r.confirmed)} onClick={e.confirmAll}>Підтвердити всі контури</button>
          <button className={button} disabled={blocked || !room} onClick={() => room && e.requestDelete("room", room.id)}>Видалити приміщення</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label>Прилад <select aria-label="Вибрати прилад" value={device?.id ?? ""} disabled={blocked} onChange={event => e.selectDevice(event.target.value)} className={button}>
            <option value="">Виберіть прилад</option>
            {devices.map((d, i) => <option key={d.id} value={d.id}>{i+1}. {DEVICE_LABELS[d.type]}</option>)}
          </select></label>
          <button className={button} disabled={blocked || !devicesEditable} onClick={() => e.beginDevice()}>Додати прилад</button>
          <button className={button} disabled={blocked || !devicesEditable || !device} onClick={() => e.beginDevice(device)}>Перемістити прилад</button>
          <button className={button} disabled={blocked || !devicesEditable || !device} onClick={() => device && e.requestDelete("device", device.id)}>Видалити прилад</button>
        </div>
        {!devicesEditable && <p className="text-sm">Редагування приладів доступне після розміщення.</p>}
      </>}
      {e.draft && <div className="space-y-3">
        <p role="status">Зміни не збережено. {e.draft.kind === "room" ? e.draft.id ? "Перетягніть вершини контуру. Після збереження підтвердьте змінений контур." : "Клацайте по кутах нового приміщення." : "Клацніть на плані або перетягніть позначку. Стрілки пересувають вибрану позначку або вершину."}</p>
        {e.draft.kind === "room" && !e.draft.id && <label>Назва приміщення <input aria-label="Назва нового приміщення" className={button} value={e.draft.name} onChange={event => e.setName(event.target.value)} /></label>}
        {e.draft.kind === "zone" && <>
          <p>Обведіть частину вибраного приміщення багатокутником. Додайте решту зон окремо. Перетягування вершин уточнює межі.</p>
          <label>Назва зони <input maxLength={200} value={e.draft.name} onChange={event => e.setName(event.target.value)} className={button} /></label>{" "}
          <label>Висота зони, м <input type="number" min="0.01" max="100" step="any" value={e.draft.height} onChange={event => e.setHeight(event.target.value)} className={button} /></label>
          <p className="text-sm">Порожня висота — «Недостатньо даних»: ця зона не бере участі в розміщенні.</p>
        </>}
        {e.draft.kind === "exit" && <>
          <p>Клацніть по вихідних дверях на DXF-плані. За потреби перетягніть позначку, потім збережіть.</p>
          <label>Назва виходу <input maxLength={200} value={e.draft.name} onChange={event => e.setName(event.target.value)} className={button} /></label>
        </>}
        {e.draft.kind === "device" && <label>Тип приладу <select aria-label="Тип приладу" className={button} value={e.draft.type} onChange={event => e.setType(event.target.value as Device["type"])}>
          {Object.entries(DEVICE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select></label>}
        <div className="flex flex-wrap gap-2">
          {(e.draft.kind === "room" || e.draft.kind === "zone") && !e.draft.id && <button className={button} disabled={!e.draft.points.length || e.uncertain} onClick={e.undoPoint}>Прибрати останню вершину</button>}
          <button className={button} disabled={e.uncertain} onClick={e.save}>Зберегти зміни</button>
          <button className={button} onClick={e.cancel}>Скасувати зміни</button>
        </div>
      </div>}
      {e.deletion && <div role="alertdialog" aria-label="Підтвердження видалення" className="rounded-lg border p-3 space-y-2">
        <p>Видалити {e.deletion.kind === "room" ? "приміщення? Прилади залишаться без прив’язки до нього." : e.deletion.kind === "zone" ? "зону приміщення?" : e.deletion.kind === "exit" ? "позначення евакуаційного виходу?" : "прилад із плану та вихідного DXF?"}</p>
        <button className={button} disabled={e.uncertain} onClick={e.deleteSelected}>Підтвердити видалення</button>{" "}
        <button className={button} onClick={e.cancelDelete}>Скасувати видалення</button>
      </div>}
    </fieldset>
    {e.busy && <p role="status">Збереження й оновлення плану…</p>}
    {e.notice && <p role="status">{e.notice}</p>}
    {e.error && <p role="alert">{e.error}</p>}
    {e.uncertain && <button className={button} disabled={e.busy} onClick={() => void e.reconcile()}>Оновити дані після помилки</button>}
  </section>;
}
