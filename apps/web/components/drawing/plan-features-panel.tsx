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
  return <div role="region" aria-label="Зони та евакуаційні виходи" className={styles.panels}>
    {loading && <p role="status">Завантаження зон і виходів…</p>}
    {error && <div role="alert">Не вдалося завантажити зони й виходи. <button className={button} disabled={loading || editor.blocked} onClick={retry}>Повторити завантаження</button></div>}
    {!loading && !error && <>
      <section className={styles.panel} aria-label="Зони висоти стелі"><h2 className={styles.heading}>Редагування зон</h2><div className={styles.content}>
      <p>{room ? room.name || "Приміщення без назви" : "Виберіть приміщення на плані або у списку редактора."}</p>
      <p>Зони належать одному приміщенню. Висота кожної зони незалежна.</p>
      <button className={button} disabled={blocked || !room} onClick={() => room && editor.beginZone(room)}>Додати зону багатокутником</button>
      {room && <ul className="space-y-2">{zones.filter(z => z.roomId === room.id).map((z, i) => <li key={z.id} className="flex flex-wrap items-center gap-2">
        <strong>{z.name || `Зона ${i + 1}`}</strong>
        <span className={z.height == null ? styles.warning : undefined}>{z.height == null ? "Недостатньо даних: немає висоти" : `Висота стелі: ${z.height.toLocaleString("uk-UA", { minimumFractionDigits: 2 })} м`}</span>
        {z.height == null && <p>У цій зоні розміщення недоступне. Решта зон обробляються незалежно.</p>}
        <button className={button} disabled={blocked} onClick={() => editor.beginZone(room, z)}>Редагувати зону</button>
        <button className={button} disabled={blocked} onClick={() => editor.requestDelete("zone", z.id)}>Видалити зону</button>
      </li>)}</ul>}
      </div></section>
      <section className={styles.panel} aria-label="Евакуаційні виходи"><h2 className={styles.heading}>Евакуаційні виходи</h2><div className={styles.content}>
      {!exits.length && <div className={styles.emptyState}>
        <strong role="status">Позначте евакуаційні виходи</strong>
        <p>0 виходів розпізнано</p>
        <p>Система не знайшла шар EXITS або підпис «Вихід» біля дверей.</p>
        <h4>Як додати вихід</h4>
        <ol><li>Увімкніть режим позначення.</li><li>Натисніть на потрібні двері.</li><li>Збережіть вибір.</li></ol>
        <p>Ручні сповіщувачі не розміщуються, доки не позначено хоча б один евакуаційний вихід.</p>
      </div>}
      <button className={button} disabled={blocked} onClick={editor.beginExit}>Позначити евакуаційний вихід</button>
      <ul className="space-y-2">{exits.map((exit, i) => <li key={exit.id} className="flex flex-wrap items-center gap-2">
        <strong>{exit.name || `Вихід ${i + 1}`}</strong><span className={styles.source}>{exit.source === "dxf" ? "Автоматично · EXITS / Вихід" : "Вручну"}</span>
        <button className={button} disabled={blocked} onClick={() => editor.requestDelete("exit", exit.id)}>Прибрати позначення</button>
      </li>)}</ul>
      <p className="text-sm">Щоб змінити збережений вихід, приберіть позначення й додайте його на потрібних дверях. Після змін повторіть розміщення приладів.</p>
      </div></section>
    </>}
  </div>;
}
