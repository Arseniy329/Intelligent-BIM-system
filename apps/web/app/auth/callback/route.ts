import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function callbackRedirect(destination: URL) {
  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function safeNextUrl(next: string | null, origin: string) {
  const fallback = new URL("/upload", origin);

  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }

  try {
    const destination = new URL(next, origin);
    return destination.origin === origin ? destination : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return callbackRedirect(safeNextUrl(searchParams.get("next"), origin));
      }
    } catch {
      // The redirect below provides a generic error without exposing auth details.
    }
  }

  return callbackRedirect(new URL("/login?error=callback", origin));
}
