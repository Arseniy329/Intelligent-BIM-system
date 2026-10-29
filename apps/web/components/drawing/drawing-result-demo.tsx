"use client";

import { useEffect, useRef, useState } from "react";
import { DrawingDetail } from "./drawing-detail";
import { createDemoDrawingApi, DEMO_DRAWING_IDS } from "@/lib/drawing/demo-api";
import { DEMO_DISPLAY_DXF } from "@/lib/drawing/demo-drawing";
import { isDrawingDemoEnabled } from "@/lib/drawing/demo-mode";
import type { DrawingApi } from "@/lib/drawing/drawing-api";

export function DrawingResultDemo() {
  const [id, setId] = useState<string>("demo-uploaded");
  const [api, setApi] = useState<DrawingApi | null>(null);
  const fileUrl = useRef<string | null>(null);
  useEffect(() => () => { if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); }, []);
  if (!isDrawingDemoEnabled()) return null;
  return <div className="space-y-5">
    <label className="flex flex-wrap items-center gap-3">Демонстраційне креслення
      <select aria-label="Демонстраційне креслення" className="min-h-10 max-w-full rounded-lg border p-2" value={id} onChange={event => setId(event.target.value)}>
        {DEMO_DRAWING_IDS.map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    {api ? <DrawingDetail id={id} api={api} demo /> : <button className="min-h-10 rounded-lg border px-4" onClick={() => {
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
      fileUrl.current = URL.createObjectURL(new Blob([DEMO_DISPLAY_DXF], { type: "application/dxf" }));
      setApi(createDemoDrawingApi(fileUrl.current));
    }}>Відкрити демо результату</button>}
  </div>;
}
