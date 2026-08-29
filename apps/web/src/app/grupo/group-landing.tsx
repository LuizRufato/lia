"use client";

import { useEffect, useState } from "react";

type RouteInfo = {
  available: boolean;
  reason?: string;
  group?: {
    name: string;
    inviteUrl: string;
    memberCount: number;
    capacity: number;
  };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function eventId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function GroupLanding({ token }: { token?: string }) {
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const response = await fetch(
          `${API_URL}/public/acquisition/group/${token}`,
          {
            cache: "no-store",
          },
        );
        setRoute(await response.json());
      } finally {
        setLoading(false);
      }
    };
    void load();
    void sendEvent(token, "LANDING_VIEW");
  }, [token]);

  async function join() {
    if (!token || !route?.available || !route.group) return;
    setRedirecting(true);
    await sendEvent(token, "JOIN_CTA_CLICK");
    await sendEvent(token, "WHATSAPP_REDIRECT");
    window.location.assign(route.group.inviteUrl);
  }

  return (
    <main className="min-h-screen bg-[#fbfaf8] px-5 py-8 text-[#111114] sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col justify-between">
        <header className="flex items-center justify-between">
          <a href="/" className="text-2xl font-black tracking-tight">
            LIA<span className="text-[#1468ed]">ϟ</span>
          </a>
          <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">
            LIA Achou!
          </span>
        </header>
        <section className="grid items-center gap-10 py-16 md:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#1468ed]">
              Ofertas selecionadas pela LIA
            </p>
            <h1 className="max-w-xl text-4xl font-black leading-tight sm:text-6xl">
              Uma IA procurando ofertas. Você só recebe as melhores.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-600">
              A LIA monitora oportunidades, analisa os dados e compartilha
              descobertas reais no WhatsApp.
            </p>
            <button
              type="button"
              disabled={loading || redirecting || !token || !route?.available}
              onClick={() => void join()}
              className="mt-8 rounded-full bg-[#1468ed] px-6 py-4 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {redirecting
                ? "Abrindo WhatsApp…"
                : token
                  ? "ENTRAR GRÁTIS NO WHATSAPP"
                  : "ACESSE PELO LINK DA CAMPANHA"}
            </button>
            {token && !loading && !route?.available && (
              <p className="mt-4 text-sm font-semibold text-slate-600">
                Estamos preparando novas vagas.
              </p>
            )}
          </div>
          <div className="rounded-[2rem] border border-white bg-white/75 p-8 shadow-2xl shadow-slate-200">
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-50 text-5xl">
              ϟ
            </div>
            <h2 className="text-2xl font-bold">Preço bom de verdade.</h2>
            <div className="mt-6 space-y-4 text-slate-600">
              <p>• A LIA encontra oportunidades.</p>
              <p>• Você recebe contexto para decidir.</p>
              <p>• A participação no grupo é gratuita.</p>
            </div>
            {route?.group && (
              <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm">
                <strong>{route.group.name}</strong>
                <p className="mt-1 text-slate-500">
                  {Math.max(0, route.group.capacity - route.group.memberCount)}{" "}
                  vagas calculadas a partir do registro atual.
                </p>
              </div>
            )}
          </div>
        </section>
        <footer className="border-t border-slate-200 py-6 text-sm text-slate-500">
          Você procura. A LIA acha.
        </footer>
      </div>
    </main>
  );
}

async function sendEvent(
  token: string,
  type: "LANDING_VIEW" | "JOIN_CTA_CLICK" | "WHATSAPP_REDIRECT",
) {
  try {
    await fetch(`${API_URL}/public/acquisition/group/${token}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: eventId(),
        type,
        deviceClass: "browser",
      }),
      keepalive: true,
    });
  } catch {
    // Analytics must never block the visitor's path to WhatsApp.
  }
}
