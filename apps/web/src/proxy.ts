import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("Authentication")?.value;

  if (!token && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (token) {
    if (
      request.nextUrl.pathname.startsWith("/login") ||
      request.nextUrl.pathname === "/"
    ) {
      return NextResponse.redirect(new URL("/overview", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
