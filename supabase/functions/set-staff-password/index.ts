import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://inventory.inmarsystems.com",
  "https://kg3924.github.io",
]);

export type PasswordDeps = {
  getUser: () => PromiseLike<{ id: string } | null>;
  profileById: (id: string) => PromiseLike<{ fullName: string | null; error?: string | null }>;
  nameInProfiles: (name: string) => PromiseLike<{ found: boolean; error?: string | null }>;
  setByName: (name: string, password: string) => PromiseLike<{ error: string | null }>;
};

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

function headersFor(req: Request, jsonBody: boolean): Headers {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  const origin = allowedOrigin(req);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  if (jsonBody) headers.set("Content-Type", "application/json");
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

export async function handleSetStaffPassword(req: Request, deps: PasswordDeps | null): Promise<Response> {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  if (!deps) return json(req, { error: "Not signed in" }, 401);

  const user = await deps.getUser();
  if (!user) return json(req, { error: "Sign out and unlock again, then set the password." }, 401);

  const profile = await deps.profileById(user.id);
  if (profile.error) return json(req, { error: profile.error || "Could not set password" }, 400);
  if (!profile.fullName) return json(req, { error: "Not allowed" }, 403);

  let body: { name?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Missing password" }, 400);
  }
  if (!body || typeof body !== "object") return json(req, { error: "Missing password" }, 400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) return json(req, { error: "Unknown person" }, 400);

  const listed = await deps.nameInProfiles(name);
  if (listed.error) return json(req, { error: listed.error || "Could not set password" }, 400);
  if (!listed.found) return json(req, { error: "Unknown person" }, 400);
  if (password.length < 8) return json(req, { error: "Use at least 8 characters" }, 400);

  const updated = await deps.setByName(name, password);
  if (updated.error) return json(req, { error: updated.error || "Could not set password" }, 400);
  return json(req, { ok: true, self: profile.fullName === name }, 200);
}

function clientsFromEnv(req: Request): PasswordDeps | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anon || !service || !authHeader) return null;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    getUser: async () => {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const { data, error } = await userClient.auth.getUser(token);
      if (error || !data?.user?.id) return null;
      return { id: data.user.id };
    },
    profileById: async (id) => {
      const { data, error } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
      if (error) return { fullName: null, error: error.message || "Could not set password" };
      const fullName = data && typeof data.full_name === "string" ? data.full_name : null;
      return { fullName };
    },
    nameInProfiles: async (name) => {
      const { data, error } = await admin.from("profiles").select("id").eq("full_name", name).maybeSingle();
      if (error) return { found: false, error: error.message || "Could not set password" };
      return { found: !!(data && data.id) };
    },
    setByName: async (name, password) => {
      const { error } = await admin.rpc("set_staff_password_by_name", {
        target_name: name,
        new_password: password,
      });
      if (error) return { error: error.message || "Could not set password" };
      return { error: null };
    },
  };
}

if (import.meta.main) {
  Deno.serve((req) => handleSetStaffPassword(req, clientsFromEnv(req)));
}
