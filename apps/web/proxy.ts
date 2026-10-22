import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:avif|css|eot|gif|ico|jpeg|jpg|js|map|png|svg|txt|ttf|webmanifest|webp|woff|woff2|xml)$).*)",
  ],
};
