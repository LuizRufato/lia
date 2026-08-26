import { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  internalApiUrl,
  noStoreJson,
} from "../cookie";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cookie = request.headers.get("cookie");

  try {
    await fetch(internalApiUrl("/auth/logout"), {
      method: "POST",
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });
  } catch {
    // The browser cookie is cleared below even if the upstream session is gone.
  }

  const response = noStoreJson({ message: "Logout efetuado com sucesso" });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...authCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
