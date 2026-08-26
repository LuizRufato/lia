import { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  internalApiUrl,
  noStoreJson,
} from "../cookie";

export const dynamic = "force-dynamic";

function getAuthenticationCookie(setCookie: string | null) {
  return setCookie?.match(/(?:^|,\s*)Authentication=([^;]+)/i)?.[1] ?? null;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return noStoreJson(
      { message: "Payload de login inválido" },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["email", "password"].includes(key)) ||
    typeof (body as { email?: unknown }).email !== "string" ||
    typeof (body as { password?: unknown }).password !== "string" ||
    !(body as { email: string }).email.trim() ||
    !(body as { password: string }).password
  ) {
    return noStoreJson(
      { message: "E-mail e senha são obrigatórios" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(internalApiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return noStoreJson(
      { message: "Não foi possível conectar ao serviço de autenticação" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errorBody = await upstream.json().catch(() => null);
    return noStoreJson(
      { message: errorBody?.message || "Erro ao fazer login" },
      { status: upstream.status },
    );
  }

  const headersWithSetCookie = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const upstreamCookie =
    headersWithSetCookie.getSetCookie?.().join(", ") ||
    upstream.headers.get("set-cookie");
  const token = getAuthenticationCookie(upstreamCookie);

  if (!token) {
    return noStoreJson(
      { message: "Serviço de autenticação não retornou uma sessão válida" },
      { status: 502 },
    );
  }

  const response = noStoreJson({ message: "Autenticado com sucesso" });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    ...authCookieOptions(),
    maxAge: 24 * 60 * 60,
  });
  return response;
}
