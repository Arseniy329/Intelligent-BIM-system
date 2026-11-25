"use client";
import type { Room } from "@bim/contracts";
import type { PlanEditor } from "@/lib/drawing/use-plan-editor";
import type { PlanExit, RoomZone } from "@/lib/drawing/plan-features-api";
import styles from "./plan-features-panel.module.css";

const button = styles.button;
export function PlanFeaturesPanel({ editor, room, zones, exits, loading, error, disabled, retry }: {
  editor: PlanEditor; room?: Room; zones: RoomZone[]; exits: PlanExit[];
  loading: boolean; error: boolean; disabled: boolean; retry: () => void;
}) {
  const blocked = disabled || editor.blocked || loading || error;
  return <section aria-label="Зони та евакуаційні виходи" className={styles.panel}>
    <h2 className={styles.heading}>Зони та евакуаційні виходи</h2>
    <div className={styles.content}>
    {loading && <p role="status">Завантаження зон і виходів…</p>}
    {error && <div role="alert">Не вдалося завантажити зони й виходи. <button className={button} disabled={loading || editor.blocked} onClick={retry}>Повторити завантаження</button></div>}
    {!loading && !error && <>
      <p>{room ? `Зони: ${room.name || "Приміщення без назви"}` : "Виберіть приміщення на плані або у списку редактора."}</p>
      <button className={button} disabled={blocked || !room} onClick={() => room && editor.beginZone(room)}>Додати зону багатокутником</button>
      {room && <ul className="space-y-2">{zones.filter(z => z.roomId === room.id).map((z, i) => <li key={z.id} className="flex flex-wrap items-center gap-2">
        <span>{z.name || `Зона ${i + 1}`} · {z.height == null ? "Недостатньо даних: немає висоти" : `${z.height} м`}</span>
        <button className={button} disabled={blocked} onClick={() => editor.beginZone(room, z)}>Редагувати зону</button>
        <button className={button} disabled={blocked} onClick={() => editor.requestDelete("zone", z.id)}>Видалити зону</button>
      </li>)}</ul>}
      {!exits.length && <p role="status">Позначте евакуаційні виходи</p>}
      <button className={button} disabled={blocked} onClick={editor.beginExit}>Позначити евакуаційний вихід</button>
      <ul className="space-y-2">{exits.map((exit, i) => <li key={exit.id} className="flex flex-wrap items-center gap-2">
        <span>{exit.name || `Вихід ${i + 1}`} · {exit.source === "dxf" ? "Знайдено в DXF" : "Позначено вручну"}</span>
        <button className={button} disabled={blocked} onClick={() => editor.requestDelete("exit", exit.id)}>Прибрати позначення</button>
      </li>)}</ul>
      <p className="text-sm">Щоб змінити збережений вихід, приберіть позначення й додайте його на потрібних дверях. Після змін повторіть розміщення приладів.</p>
    </>}
    </div>
  </section>;
}
