import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("Authentication")?.value;

  const isPublicLanding = request.nextUrl.pathname === "/";
  const isPublicGroupLanding =
    request.nextUrl.pathname === "/grupo" ||
    request.nextUrl.pathname.startsWith("/grupo/");
  const isPublicBrandAsset = request.nextUrl.pathname.startsWith("/brand/");
  const isPublicSeoFile = ["/robots.txt", "/sitemap.xml"].includes(
    request.nextUrl.pathname,
  );
  if (
    !token &&
    !isPublicLanding &&
    !isPublicGroupLanding &&
    !isPublicBrandAsset &&
    !isPublicSeoFile &&
    !request.nextUrl.pathname.startsWith("/login")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
