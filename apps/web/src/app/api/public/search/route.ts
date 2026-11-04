import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 10_000;

async function forward(path: string, init?: RequestInit) {
  // Same fallback rule as the auth BFF (apps/web/src/app/api/auth/cookie.ts):
  // in dev/test fall back to NEXT_PUBLIC_API_URL (default localhost:3000)
  // so the public search works without API_INTERNAL_URL.
  const raw =
    process.env.API_INTERNAL_URL ||
    (process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"
      : "http://api:3000");
  const apiUrl = raw.replace(/\/$/, "");
  try {
    const response = await fetch(`${apiUrl}/public/search${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return NextResponse.json(
      {
        status: "MARKETPLACE_UNAVAILABLE",
        message:
          "A LIA está atualizando as oportunidades. Tente novamente em instantes.",
      },
      { status: 503 },
    );
  }
}

export async function GET() {
  return forward("/featured");
}

export async function POST(request: Request) {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { message: "Busca muito grande." },
      { status: 413 },
    );
  }
  return forward("", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
