import { redirect } from "next/navigation";
import { DrawingPreview } from "@/components/drawing/drawing-preview";
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { DrawingResultDemo } from "@/components/drawing/drawing-result-demo";
import { isDrawingDemoEnabled } from "@/lib/drawing/demo-mode";

export default async function DrawingPreviewPage({ searchParams }: { searchParams?: Promise<{ result?: string }> } = {}) {
  // Match the proxy's local-only exception without bypassing other protected routes.
  if (process.env.NODE_ENV !== "development") {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) redirect("/login");
  }

  const showResult = isDrawingDemoEnabled() && (await searchParams)?.result === "true";
  return <AppShell>{showResult ? <DrawingResultDemo /> : <DrawingPreview />}</AppShell>;
}
