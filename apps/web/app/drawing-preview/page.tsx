import { redirect } from "next/navigation";
import { DrawingPreview } from "@/components/drawing/drawing-preview";
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function DrawingPreviewPage() {
  // Match the proxy's local-only exception without bypassing other protected routes.
  if (process.env.NODE_ENV !== "development") {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) redirect("/login");
  }

  return <AppShell><DrawingPreview /></AppShell>;
}
