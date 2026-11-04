import { NextResponse } from "next/server";

// BFF for the public group landing. The browser must not call the API
// directly (CORS + baked NEXT_PUBLIC_API_URL breaks in production); this
// route forwards server-side using the same internal URL rules as the
// search BFF, with NEXT_PUBLIC_API_URL as a fallback for local dev.

const MAX_BODY_BYTES = 10_000;

function internalApiUrl(): string {
  const raw =
    process.env.API_INTERNAL_URL ||
    (process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
      ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"
      : "http://api:3000");
  return raw.replace(/\/$/, "");
}

async function forward(
  path: string,
  init?: RequestInit,
): Promise<NextResponse> {
  const apiUrl = internalApiUrl();
  try {
    const response = await fetch(`${apiUrl}/public/acquisition/group${path}`, {
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
      { available: false, reason: "UNAVAILABLE" },
      { status: 503 },
    );
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return forward(`/${encodeURIComponent(token)}`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "Payload muito grande." }, { status: 413 });
  }
  const { token } = await params;
  return forward(`/${encodeURIComponent(token)}/events`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
