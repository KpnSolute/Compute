// session-status: resolves an already-authenticated user's profile + credential
// flags directly from Supabase, without a round-trip to the FastAPI backend.
// Accepts either a native Supabase Auth JWT (ES256, admin/manager sessions) or
// an HS256 staff JWT minted by pin-login / backend/routes/auth.py (same claim
// shape: sub, role, iat, exp).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jwtVerify, decodeProtectedHeader } from "https://esm.sh/jose@5";

const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const devOrigins = [
  "https://kpncompute.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowList = allowedOrigins.length ? allowedOrigins : devOrigins;
  const allowOrigin = !origin || allowList.includes(origin) ? origin || allowList[0] : allowList[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// Mirrors backend/routes/auth.py's _credential_flags()
function credentialFlags(user: Record<string, unknown>) {
  return {
    must_change_password: !!user.must_change_password,
    must_change_pin: user.role === "staff" && user.pin === "2222",
  };
}

async function resolveUserId(token: string): Promise<string | null> {
  // Native Supabase Auth session (ES256/admin-signed) — verify via GoTrue.
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "HS256") {
      const v2 = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      const { data, error } = await v2.auth.getUser(token);
      if (!error && data.user) return data.user.id;
    }
  } catch {
    // fall through to HS256 path
  }

  // Staff HS256 token (pin-login / FastAPI's staff branch) — verify with the
  // shared JWT secret so this stays a drop-in for the existing backend.
  try {
    const secret = new TextEncoder().encode(required("SUPABASE_JWT_SECRET"));
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });

    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || token.split(".").length !== 3) return json(req, { error: "Missing or invalid token" }, 401);

    const userId = await resolveUserId(token);
    if (!userId) return json(req, { error: "Invalid or expired token" }, 401);

    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: user, error } = await admin
      .from("user_profiles")
      .select("id, username, display_name, last_name, role, active, must_change_password, pin")
      .eq("id", userId)
      .single();

    if (error || !user || user.active === false) return json(req, { error: "User not found or inactive" }, 401);

    return json(req, {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      last_name: user.last_name ?? "",
      role: user.role,
      active: user.active,
      ...credentialFlags(user),
    });
  } catch (e) {
    console.error("session_status_unhandled", e instanceof Error ? e.message : e);
    return json(req, { error: "Session status check is temporarily unavailable." }, 500);
  }
});
