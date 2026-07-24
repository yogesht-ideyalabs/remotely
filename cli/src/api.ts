import type { CliSession } from "./config.js";

export interface Resource {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  folder: string;
  type: string;
}

export async function apiFetch(baseUrl: string, path: string, token: string | null, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function fetchResources(session: CliSession): Promise<Resource[]> {
  return apiFetch(session.controlPlaneUrl, "/api/resources", session.token);
}
