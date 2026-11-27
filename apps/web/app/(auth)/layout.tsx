import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthFrame } from "@/components/auth/auth-frame";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (!error && data?.claims) {
    redirect("/upload");
  }

  return (
    <AuthFrame>{children}</AuthFrame>
  );
}
