import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 10_000;

async function forward(path: string, init?: RequestInit) {
  const apiUrl = (process.env.API_INTERNAL_URL || "http://api:3000").replace(
    /\/$/,
    "",
  );
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
