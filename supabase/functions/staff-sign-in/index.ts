import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://inventory.inmarsystems.com",
  "https://kg3924.github.io",
]);

const WRONG = "Name or password is wrong.";
const BUSY = "Sign-in is busy. Try again in a minute.";

type SessionFields = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  token_type?: unknown;
  user?: unknown;
};

export type StaffSignInClients = {
  service: {
    rpc: (
      fn: string,
      args: { p_name: string },
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  };
  anon: {
    auth: {
      signInWithPassword: (creds: { email: string; password: string }) => PromiseLike<{
        data: { session: SessionFields | null; user?: unknown } | null;
        error: { message?: string; status?: number; statusCode?: number | string } | null;
      }>;
    };
  };
};

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

function headersFor(req: Request, json: boolean): Headers {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  const origin = allowedOrigin(req);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

function json(req: Request, body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: headersFor(req, true) });
}

function options(req: Request): Response {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  const origin = allowedOrigin(req);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, x-client-info, apikey, content-type",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(null, { status: 204, headers });
}

function authStatus(error: { status?: number; statusCode?: number | string } | null): number | null {
  if (!error) return null;
  const raw = error.status ?? error.statusCode;
  const status = typeof raw === "string" ? Number(raw) : raw;
  if (typeof status !== "number" || !Number.isFinite(status)) return null;
  return status;
}

function authIsBusy(status: number | null): boolean {
  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

export async function handleStaffSignIn(req: Request, clients: StaffSignInClients): Promise<Response> {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  let body: { name?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: WRONG }, 400);
  }
  if (!body || typeof body !== "object") return json(req, { error: WRONG }, 400);
  if (typeof body.name !== "string" || typeof body.password !== "string") {
    return json(req, { error: WRONG }, 400);
  }
  const name = body.name.trim();
  const password = body.password;
  if (!name || !password) return json(req, { error: WRONG }, 400);

  const lookup = await clients.service.rpc("shop_staff_email", { p_name: name });
  if (lookup.error) return json(req, { error: BUSY }, 503);
  const email = lookup.data;
  if (typeof email !== "string" || email.length === 0) return json(req, { error: WRONG }, 401);

  let signed: Awaited<ReturnType<StaffSignInClients["anon"]["auth"]["signInWithPassword"]>>;
  try {
    signed = await clients.anon.auth.signInWithPassword({ email, password });
  } catch {
    return json(req, { error: BUSY }, 503);
  }
  if (signed.error) {
    if (authIsBusy(authStatus(signed.error))) return json(req, { error: BUSY }, 503);
    return json(req, { error: WRONG }, 401);
  }
  const session = signed.data?.session;
  const accessToken = session?.access_token;
  const refreshToken = session?.refresh_token;
  if (typeof accessToken !== "string" || !accessToken) return json(req, { error: WRONG }, 401);
  if (typeof refreshToken !== "string" || !refreshToken) return json(req, { error: WRONG }, 401);
  return json(req, {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: session?.expires_in ?? null,
    expires_at: session?.expires_at ?? null,
    token_type: session?.token_type ?? null,
  }, 200);
}

function clientsFromEnv(): StaffSignInClients {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = { persistSession: false, autoRefreshToken: false };
  return {
    service: createClient(url, serviceKey, { auth }) as unknown as StaffSignInClients["service"],
    anon: createClient(url, anonKey, { auth }) as unknown as StaffSignInClients["anon"],
  };
}

if (import.meta.main) {
  Deno.serve((req) => handleStaffSignIn(req, clientsFromEnv()));
}
