import { assertEquals } from "jsr:@std/assert";
import { handleStaffSignIn } from "./index.ts";

const SHOP = "https://inventory.inmarsystems.com";
const PAGES = "https://kg3924.github.io";
const EVIL = "https://evil.example";
const WRONG = "Name or password is wrong.";
const BUSY = "Sign-in is busy. Try again in a minute.";
const NAME = "ZZ Test Staff";
const EMAIL = "zz.staff@example.test";
const PASSWORD = "test-password-123";

const TOKENS = {
  access_token: "access-token-zz",
  refresh_token: "refresh-token-zz",
  expires_in: 3600,
  expires_at: 1_800_000_000,
  token_type: "bearer",
};

type RpcCall = { fn: string; args: { p_name: string } };
type AuthCall = { email: string; password: string };

function post(body: unknown, origin?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://project.supabase.co/functions/v1/staff-sign-in", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function options(origin?: string): Request {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  return new Request("https://project.supabase.co/functions/v1/staff-sign-in", {
    method: "OPTIONS",
    headers,
  });
}

function stub(opts: {
  email?: string | null;
  authError?: { message: string; status: number } | null;
  session?: Record<string, unknown> | null;
}) {
  const rpcCalls: RpcCall[] = [];
  const authCalls: AuthCall[] = [];
  const clients = {
    service: {
      rpc: async (fn: string, args: { p_name: string }) => {
        rpcCalls.push({ fn, args });
        return { data: opts.email ?? null, error: null };
      },
    },
    anon: {
      auth: {
        signInWithPassword: async (creds: { email: string; password: string }) => {
          authCalls.push(creds);
          if (opts.authError) return { data: { session: null, user: null }, error: opts.authError };
          return {
            data: {
              user: { id: "zz-user", email: opts.email },
              session: {
                ...(opts.session ?? TOKENS),
                user: { id: "zz-user", email: opts.email },
              },
            },
            error: null,
          };
        },
      },
    },
  };
  return { clients, rpcCalls, authCalls };
}

Deno.test("unknown name returns 401 and does not call Auth", async () => {
  const { clients, rpcCalls, authCalls } = stub({ email: null });
  const res = await handleStaffSignIn(post({ name: NAME, password: PASSWORD }, SHOP), clients);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: WRONG });
  assertEquals(rpcCalls, [{ fn: "shop_staff_email", args: { p_name: NAME } }]);
  assertEquals(authCalls, []);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("wrong password returns 401 and hides the Auth error", async () => {
  const { clients, authCalls } = stub({
    email: EMAIL,
    authError: { message: "Invalid login credentials", status: 400 },
  });
  const res = await handleStaffSignIn(post({ name: NAME, password: PASSWORD }), clients);
  const body = await res.json();
  assertEquals(res.status, 401);
  assertEquals(body, { error: WRONG });
  assertEquals(authCalls, [{ email: EMAIL, password: PASSWORD }]);
  assertEquals(JSON.stringify(body).includes(EMAIL), false);
  assertEquals(JSON.stringify(body).includes("Invalid login credentials"), false);
});

Deno.test("Auth 429 returns 503", async () => {
  const { clients } = stub({
    email: EMAIL,
    authError: { message: "Request rate limit reached", status: 429 },
  });
  const res = await handleStaffSignIn(post({ name: NAME, password: PASSWORD }), clients);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: BUSY });
});

Deno.test("Auth 500 returns 503", async () => {
  const { clients } = stub({
    email: EMAIL,
    authError: { message: "upstream failed", status: 500 },
  });
  const res = await handleStaffSignIn(post({ name: NAME, password: PASSWORD }), clients);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: BUSY });
});

Deno.test("success returns only the five token fields", async () => {
  const { clients } = stub({ email: EMAIL });
  const res = await handleStaffSignIn(post({ name: NAME, password: PASSWORD }, SHOP), clients);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(Object.keys(body).sort(), [
    "access_token",
    "expires_at",
    "expires_in",
    "refresh_token",
    "token_type",
  ]);
  assertEquals(body, TOKENS);
  const text = JSON.stringify(body);
  assertEquals(text.includes(EMAIL), false);
  assertEquals(text.includes("zz-user"), false);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), SHOP);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("OPTIONS from the shop origin returns 204 with the three allow headers", async () => {
  const { clients, rpcCalls, authCalls } = stub({ email: EMAIL });
  const res = await handleStaffSignIn(options(SHOP), clients);
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), SHOP);
  assertEquals(
    res.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(rpcCalls, []);
  assertEquals(authCalls, []);
});

Deno.test("OPTIONS from an unknown origin returns 204 with no CORS headers and no database call", async () => {
  const { clients, rpcCalls, authCalls } = stub({ email: EMAIL });
  const res = await handleStaffSignIn(options(EVIL), clients);
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), null);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(rpcCalls, []);
  assertEquals(authCalls, []);
});

Deno.test("OPTIONS from GitHub Pages is allowlisted", async () => {
  const { clients } = stub({});
  const res = await handleStaffSignIn(options(PAGES), clients);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), PAGES);
});

Deno.test("missing name or password returns 400 and does not call the database", async () => {
  const { clients, rpcCalls, authCalls } = stub({ email: EMAIL });
  const missingName = await handleStaffSignIn(post({ password: PASSWORD }), clients);
  assertEquals(missingName.status, 400);
  assertEquals(await missingName.json(), { error: WRONG });
  const missingPassword = await handleStaffSignIn(post({ name: NAME }), clients);
  assertEquals(missingPassword.status, 400);
  assertEquals(await missingPassword.json(), { error: WRONG });
  assertEquals(rpcCalls, []);
  assertEquals(authCalls, []);
});

Deno.test("a method other than POST or OPTIONS returns 405", async () => {
  const { clients, rpcCalls, authCalls } = stub({ email: EMAIL });
  const res = await handleStaffSignIn(
    new Request("https://project.supabase.co/functions/v1/staff-sign-in", { method: "GET" }),
    clients,
  );
  assertEquals(res.status, 405);
  assertEquals(rpcCalls, []);
  assertEquals(authCalls, []);
  assertEquals(res.headers.get("Vary"), "Origin");
});
