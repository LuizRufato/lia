import { NextResponse } from "next/server";

export const AUTH_COOKIE_NAME = "Authentication";

export function authCookieOptions() {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function internalApiUrl(path: string) {
  const baseUrl =
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://api:3000";
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}
