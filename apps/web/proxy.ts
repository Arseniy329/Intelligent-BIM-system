import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Allow the local fixture/file viewer without Supabase configuration only in development.
  if (process.env.NODE_ENV === "development" && request.nextUrl.pathname === "/drawing-preview") {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:avif|css|eot|gif|ico|jpeg|jpg|js|map|png|svg|txt|ttf|webmanifest|webp|woff|woff2|xml)$).*)",
  ],
};
