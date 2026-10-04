import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isPublicPath, verifySession } from "@/lib/auth";

// Next.js 16 renamed middleware.ts to proxy.ts. This guard protects every
// route except /login and /api/login (build-plan P1.5).
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const ok = await verifySession(
    process.env.VIVA_SESSION_SECRET,
    request.cookies.get(COOKIE_NAME)?.value,
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals, static files, and /api/upload. The proxy buffers request
  // bodies (10 MB by default), which would truncate a WAV upload; /api/upload
  // checks auth itself.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/upload|.*\\.(?:woff2?|png|svg|ico)$).*)",
  ],
};
