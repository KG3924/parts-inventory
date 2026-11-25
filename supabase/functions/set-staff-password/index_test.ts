import { assertEquals } from "jsr:@std/assert";
import { handleSetStaffPassword, type PasswordDeps } from "./index.ts";

const SHOP = "https://inventory.inmarsystems.com";
const EVIL = "https://evil.example";
const CALLER = "ZZ Test Staff";
const OTHER = "ZZ Other Staff";
const PASSWORD = "test-password-123";

function post(body: unknown, origin?: string): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  });
  if (origin) headers.set("Origin", origin);
  return new Request("https://project.supabase.co/functions/v1/set-staff-password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function deps(opts: {
  user?: { id: string } | null;
  profile?: string | null;
  names?: string[];
}): { deps: PasswordDeps; sets: { name: string; password: string }[]; reads: number } {
  const sets: { name: string; password: string }[] = [];
  let reads = 0;
  return {
    sets,
    get reads() {
      return reads;
    },
    deps: {
      getUser: async () => opts.user === undefined ? { id: "zz-user" } : opts.user,
      profileById: async () => {
        reads++;
        if (opts.profile === undefined) return { fullName: CALLER };
        if (opts.profile === null) return { fullName: null };
        return { fullName: opts.profile };
      },
      nameInProfiles: async (name: string) => {
        reads++;
        return { found: (opts.names ?? [CALLER, OTHER]).includes(name) };
      },
      setByName: async (name: string, password: string) => {
        sets.push({ name, password });
        return { error: null };
      },
    },
  };
}

Deno.test("OPTIONS from the shop origin returns 204 and does not read profiles", async () => {
  const built = deps({});
  const res = await handleSetStaffPassword(
    new Request("https://project.supabase.co/functions/v1/set-staff-password", {
      method: "OPTIONS",
      headers: { Origin: SHOP },
    }),
    built.deps,
  );
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), SHOP);
  assertEquals(
    res.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(built.reads, 0);
  assertEquals(built.sets, []);
});

Deno.test("OPTIONS from an unknown origin returns 204 with no CORS headers", async () => {
  const built = deps({});
  const res = await handleSetStaffPassword(
    new Request("https://project.supabase.co/functions/v1/set-staff-password", {
      method: "OPTIONS",
      headers: { Origin: EVIL },
    }),
    built.deps,
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), null);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(built.reads, 0);
});

Deno.test("a caller with no profile row is not allowed", async () => {
  const built = deps({ profile: null });
  const res = await handleSetStaffPassword(post({ name: OTHER, password: PASSWORD }), built.deps);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Not allowed" });
  assertEquals(built.sets, []);
});

Deno.test("an unknown name returns Unknown person", async () => {
  const built = deps({ names: [CALLER] });
  const res = await handleSetStaffPassword(post({ name: OTHER, password: PASSWORD }, SHOP), built.deps);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Unknown person" });
  assertEquals(built.sets, []);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), SHOP);
});

Deno.test("a short password keeps today's message", async () => {
  const built = deps({});
  const res = await handleSetStaffPassword(post({ name: OTHER, password: "short" }), built.deps);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Use at least 8 characters" });
  assertEquals(built.sets, []);
});

Deno.test("setting another person's password returns self false", async () => {
  const built = deps({});
  const res = await handleSetStaffPassword(post({ name: OTHER, password: PASSWORD }), built.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, self: false });
  assertEquals(built.sets, [{ name: OTHER, password: PASSWORD }]);
});

Deno.test("setting your own password returns self true", async () => {
  const built = deps({});
  const res = await handleSetStaffPassword(post({ name: CALLER, password: PASSWORD }), built.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, self: true });
});

Deno.test("a signed-out caller is told to unlock again", async () => {
  const built = deps({ user: null });
  const res = await handleSetStaffPassword(post({ name: CALLER, password: PASSWORD }), built.deps);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Sign out and unlock again, then set the password." });
  assertEquals(built.sets, []);
});

Deno.test("missing function config returns Not signed in", async () => {
  const res = await handleSetStaffPassword(post({ name: CALLER, password: PASSWORD }), null);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Not signed in" });
});

Deno.test("the function source has no staff email list", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(src.includes("@inmarsystems.com"), false);
  assertEquals(src.includes("gmail.com"), false);
  assertEquals(src.includes("set_staff_password_by_name"), true);
  assertEquals(src.includes('rpc("set_staff_password"'), false);
});
