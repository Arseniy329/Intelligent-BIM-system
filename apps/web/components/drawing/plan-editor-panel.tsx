"use client";

import type { Device, Room } from "@bim/contracts";
import type { PlanEditor } from "@/lib/drawing/use-plan-editor";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DEVICE_LABELS } from "./device-symbol";
import styles from "./drawing-workspace.module.css";

type EditorProps = {
  editor: PlanEditor; rooms: Room[]; devices: Device[]; selectedRoomId: string | null;
  selectRoom: (id: string | null) => void; devicesEditable: boolean; disabled: boolean;
  mode?: "rooms" | "devices"; onTable?: () => void;
};

export function PlanWorkPanel({ editor: e, rooms, devices, selectedRoomId, selectRoom, devicesEditable, disabled, mode = "rooms", onPlace, placementDisabled, onExit }: EditorProps & {
  onPlace?: () => void; placementDisabled?: boolean; onExit?: () => void;
}) {
  const blocked = disabled || e.blocked;
  return <fieldset disabled={disabled || e.busy} className={styles.workControls}>
    <legend className="sr-only">Робота на плані</legend>
    <h3>РОБОТА НА ПЛАНІ</h3>
    <label className={styles.selectControl}>
      <span>{mode === "rooms" ? "Вибрати кімнату" : "Вибрати прилад"}</span>
      <select aria-label={mode === "rooms" ? "Вибрати приміщення на плані" : "Вибрати прилад"} disabled={blocked}
        value={mode === "rooms" ? selectedRoomId ?? "" : e.selectedDeviceId ?? ""}
        onChange={event => mode === "rooms" ? selectRoom(event.target.value || null) : e.selectDevice(event.target.value)}>
        <option value="">Виберіть на плані або зі списку</option>
        {mode === "rooms" ? rooms.map(room => <option key={room.id} value={room.id}>{room.name || "Без назви"}</option>)
          : devices.map((device, index) => <option key={device.id} value={device.id}>{index + 1}. {DEVICE_LABELS[device.type] ?? "Невідомий тип"}</option>)}
      </select>
    </label>
    <button disabled={blocked || mode === "devices" && !devicesEditable} onClick={() => mode === "rooms" ? e.beginRoom() : e.beginDevice()}>
      {mode === "rooms" ? "Додати кімнату" : "Додати прилад"}
    </button>
    {mode === "rooms" ? <>
      <p>{rooms.filter(room => room.confirmed).length} із {rooms.length} підтверджено</p>
      <small>{e.draft ? "Є незбережені зміни" : rooms.some(room => !room.confirmed) ? "Перевірте решту кімнат" : "Усі кімнати підтверджено"}</small>
      <button className={styles.primary} disabled={blocked || !rooms.some(room => !room.confirmed)} onClick={e.confirmAll}>Підтвердити всі</button>
      {onPlace && <button className={styles.primary} disabled={blocked || placementDisabled} onClick={onPlace}>Розмістити прилади</button>}
      <small>Після підтвердження всіх кімнат</small>
    </> : <>
      <p className={e.draft ? styles.pending : styles.success}>{e.draft ? "Зміни не збережено" : "✓ Усі зміни збережено"}</p>
      <button className={styles.primary} disabled={!e.draft || e.uncertain} onClick={e.save}>Зберегти зміни</button>
      <button onClick={() => { e.cancel(); if (!e.draft) onExit?.(); }}>{e.draft ? "Скасувати всі зміни" : "Вийти з редагування"}</button>
      <small>Кімнати та прилади — різні режими</small>
    </>}
  </fieldset>;
}

export function PlanEditorPanel({ editor: e, rooms, devices, selectedRoomId, devicesEditable, disabled, mode = "rooms", onTable }: EditorProps) {
  const room = rooms.find(item => item.id === selectedRoomId);
  const device = devices.find(item => item.id === e.selectedDeviceId);
  const draft = e.draft;
  const blocked = disabled || e.blocked;
  const selected = mode === "rooms" ? room : device;
  return <section aria-label="Редагування плану" className={styles.editorCard}>
    <h3>{mode === "rooms" ? "Деталі приміщення" : "Деталі приладу"}</h3>
    <fieldset disabled={disabled || e.busy}>
      {!draft && !selected && <div className={styles.emptyDetails}>
        <span className={styles.emptyIcon} aria-hidden="true">⌂</span>
        <strong>{mode === "rooms" ? "Виберіть приміщення" : "Виберіть прилад"}</strong>
        <p>Натисніть на {mode === "rooms" ? "кімнату" : "прилад"} на плані або її назву у списку нижче.</p>
        {mode === "rooms" && onTable && <button onClick={onTable}>Вибрати приміщення →</button>}
      </div>}
      {!draft && mode === "rooms" && room && <>
        <h4>{room.name || "Приміщення без назви"}</h4>
        <p className={styles.secondary}>{room.confirmed ? "Підтверджено" : "Не підтверджено"} · {room.source === "manual" ? "Вручну" : "Автоматично"}</p>
        <p>{room.area.toLocaleString("uk-UA")} м²{room.height != null ? ` · ${room.height.toLocaleString("uk-UA", { minimumFractionDigits: 2 })} м` : ""}</p>
        <button className={styles.primary} disabled={blocked || room.confirmed} onClick={() => e.confirm(room.id)}>Підтвердити кімнату</button>
        <button disabled={blocked} aria-label="Змінити контур" onClick={() => e.beginRoom(room)}>Редагувати контур</button>
        <div className={styles.actionRow}><button className={styles.danger} aria-label="Видалити приміщення" disabled={blocked} onClick={() => e.requestDelete("room", room.id)}>Видалити</button>
          {onTable && <button disabled={blocked} onClick={onTable}>У таблиці ↗</button>}</div>
      </>}
      {!draft && mode === "devices" && device && <>
        <h4>{DEVICE_LABELS[device.type] ?? "Невідомий тип приладу"}</h4>
        <p>{rooms.find(item => item.id === device.roomId)?.name || "Приміщення не визначено"}</p>
        <p className={styles.success}>✓ Збережене положення</p>
        <button className={styles.primary} disabled={blocked || !devicesEditable} aria-label="Перемістити прилад" onClick={() => e.beginDevice(device)}>Перемістити</button>
        <button className={styles.danger} disabled={blocked || !devicesEditable} aria-label="Видалити прилад" onClick={() => e.requestDelete("device", device.id)}>Видалити</button>
        <small>Перетягування: миша або стрілки</small>
      </>}
      {draft?.kind === "room" && <>
        <h4>{draft.id ? room?.name : "Нове приміщення"}</h4>
        <p className={styles.pending}>Зміни не збережено</p>
        {!draft.id && <label>Назва приміщення<input aria-label="Назва нового приміщення" value={draft.name} onChange={event => e.setName(event.target.value)} /></label>}
        <p>{draft.id ? "Перетягніть вершини контуру. Після збереження підтвердьте змінений контур." : "Клацайте по кутах нового приміщення."}</p>
        {!draft.id && <button disabled={!draft.points.length || e.uncertain} onClick={e.undoPoint}>Прибрати останню вершину</button>}
        <button className={styles.primary} disabled={e.uncertain} onClick={e.save}>Зберегти зміни</button>
        <button onClick={e.cancel}>Скасувати зміни</button>
      </>}
      {draft?.kind === "device" && <>
        <h4>{draft.id ? "Перемістити прилад" : "Додати прилад"}</h4>
        <label>Тип приладу<select aria-label="Тип приладу" value={draft.type} onChange={event => e.setType(event.target.value as Device["type"])}>
          {Object.entries(DEVICE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select></label>
        <p className={styles.pending}>Зміни не збережено</p>
        <small>Клацніть на плані або перетягніть прилад. Стрілки пересувають вибраний прилад.</small>
      </>}
      {!devicesEditable && mode === "devices" && <small>Редагування приладів доступне після розміщення.</small>}
    </fieldset>
    {e.busy && !e.deletion && <p role="status">Збереження й оновлення плану…</p>}
    {e.notice && <p role="status" className={styles.success}>{e.notice}</p>}
    {e.error && !e.deletion && <p role="alert">{e.error}</p>}
    {e.uncertain && !e.deletion && <button disabled={e.busy} onClick={() => void e.reconcile()}>Оновити дані після помилки</button>}
    <Dialog open={!!e.deletion} onOpenChange={open => { if (!open && !e.busy) e.cancelDelete(); }}>
      <DialogContent role="alertdialog" className={styles.deleteDialog} onEscapeKeyDown={event => { if (e.busy) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        {e.busy && <p role="status">Збереження й оновлення плану…</p>}
        {e.error && <p role="alert">{e.error}</p>}
        {e.uncertain && <button disabled={e.busy} onClick={() => void e.reconcile()}>Оновити дані після помилки</button>}
        <DialogTitle>Видалити {e.deletion?.kind === "room" ? "приміщення" : "прилад"}?</DialogTitle>
        <DialogDescription>{e.deletion?.kind === "room" ? "Контур і рядок у таблиці буде видалено. Прилади залишаться без прив’язки до нього. Вихідний DXF залишиться без змін." : "Прилад буде видалено з плану та DXF результату."}</DialogDescription>
        <div className={styles.actionRow}><button disabled={e.busy} onClick={e.cancelDelete}>Залишити {e.deletion?.kind === "room" ? "кімнату" : "прилад"}</button><button className={styles.danger} aria-label="Підтвердити видалення" disabled={e.busy || e.uncertain} onClick={e.deleteSelected}>Видалити</button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
