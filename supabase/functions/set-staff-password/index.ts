import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STAFF = [
  "glynn@inmarsystems.com",
  "kyle.grantham.kg@gmail.com",
  "toby@inmarsystems.com",
  "grant@inmarsystems.com",
  "ricky@inmarsystems.com",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anon || !service || !authHeader) return json({ error: "Not signed in" }, 401);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const caller = (userData?.user?.email || "").toLowerCase();
  if (userErr || !userData?.user) {
    return json({ error: "Sign out and unlock again, then set the password." }, 401);
  }
  if (!STAFF.includes(caller)) return json({ error: "Not allowed" }, 403);

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Missing password" }, 400);
  }
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");
  if (!STAFF.includes(email)) return json({ error: "Unknown person" }, 400);
  if (password.length < 8) return json({ error: "Use at least 8 characters" }, 400);

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: updErr } = await admin.rpc("set_staff_password", {
    target_email: email,
    new_password: password,
  });
  if (updErr) return json({ error: updErr.message || "Could not set password" }, 400);
  return json({ ok: true, self: caller === email });
});
