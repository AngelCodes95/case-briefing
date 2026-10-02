import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CLIO_BASE_URL ?? "https://app.clio.com";
const API = `${BASE}/api/v4`;
const TOKEN_FILE = path.resolve(".data/token.json");

type Tokens = { access_token: string; refresh_token?: string; expires_at: number };

function loadTokens(): Tokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 });
}

export function isConnected(): boolean {
  return loadTokens() !== null;
}

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CLIO_CLIENT_ID ?? "",
    redirect_uri: process.env.CLIO_REDIRECT_URI ?? "",
    state,
  });
  return `${BASE}/oauth/authorize?${p}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIO_CLIENT_ID ?? "",
      client_secret: process.env.CLIO_CLIENT_SECRET ?? "",
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Clio token endpoint ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const prev = loadTokens();
  const tokens: Tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? prev?.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000 - 60_000,
  };
  saveTokens(tokens);
  return tokens;
}

export async function exchangeCode(code: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.CLIO_REDIRECT_URI ?? "",
  });
}

async function accessToken(): Promise<string> {
  let t = loadTokens();
  if (!t) throw new Error("Not connected to Clio. Visit /login.");
  if (Date.now() >= t.expires_at && t.refresh_token) {
    t = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  }
  return t.access_token;
}

/**
 * The only way this app talks to Clio. It issues GET requests and nothing else,
 * so the app cannot create or modify case data even by mistake.
 */
export async function clioGet<T = any>(pathname: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(pathname.startsWith("http") ? pathname : `${API}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${await accessToken()}`, Accept: "application/json" },
      });
    } catch (err) {
      // Dropped connection: wait briefly and retry instead of failing the whole page.
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Clio GET ${url.pathname} -> ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  throw new Error(`Clio GET ${url.pathname} rate limited`);
}

/** Follows Clio's paging links and returns every record. */
export async function clioGetAll<T = any>(pathname: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const out: T[] = [];
  let page = await clioGet<{ data: T[]; meta?: { paging?: { next?: string } } }>(pathname, { limit: 200, ...params });
  out.push(...page.data);
  while (page.meta?.paging?.next) {
    page = await clioGet(page.meta.paging.next);
    out.push(...page.data);
  }
  return out;
}
