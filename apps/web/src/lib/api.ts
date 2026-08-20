// Simple wrapper around fetch to automatically include the auth token
export async function fetchAuth(url: string, options: RequestInit = {}) {
  // In a real application, you'd get this from a cookie, context, or local storage.
  // Assuming token is stored in localStorage for this client-side call
  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem("lia_token") || "";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as any),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Base API URL
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
  const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;

  return fetch(fullUrl, {
    credentials: "include",
    ...options,
    headers,
  });
}
