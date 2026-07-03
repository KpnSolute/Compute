// pin-login: staff username+PIN login against user_profiles, minting the same
// HS256 JWT shape backend/routes/auth.py's PIN branch does (sub, role, iat,
// exp @ +12h), so the token is a drop-in valid session for the FastAPI
// backend's jwt_validator fallback — nothing on that side needs to change.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose@5";

const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const devOrigins = [
  "https://kpncompute.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const attempts = new Map<string, { count: number; resetAt: number }>();

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowList = allowedOrigins.length ? allowedOrigins : devOrigins;
  const allowOrigin = !origin || allowList.includes(origin) ? origin || allowList[0] : allowList[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function rateLimit(req: Request, username: string): Response | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const key = `${ip}:${username.toLowerCase()}`;
  const now = Date.now();
  for (const [k, v] of attempts) {
    if (v.resetAt < now) attempts.delete(k);
  }
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return null;
  }
  cur.count += 1;
  if (cur.count > 8) return json(req, { error: "Too many attempts. Try again later." }, 429);
  return null;
}

// Mirrors backend/routes/auth.py's _credential_flags()
function credentialFlags(user: Record<string, unknown>) {
  return {
    must_change_password: !!user.must_change_password,
    must_change_pin: user.role === "staff" && user.pin === "2222",
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

    let username = "";
    let pin = "";
    try {
      ({ username, pin } = await req.json());
    } catch {
      return json(req, { error: "Invalid body" }, 400);
    }
    username = (username || "").trim().toLowerCase();
    if (!username || !pin) return json(req, { error: "Username and PIN are required" }, 400);

    const limited = rateLimit(req, username);
    if (limited) return limited;

    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: user, error } = await admin
      .from("user_profiles")
      .select("id, username, display_name, last_name, role, active, must_change_password, pin")
      .eq("username", username)
      .eq("active", true)
      .single();

    if (error || !user) return json(req, { error: "Invalid credentials" }, 401);
    if (user.role !== "staff") return json(req, { error: "PIN login only available for staff" }, 401);
    if (pin !== (user.pin ?? "")) return json(req, { error: "Invalid PIN" }, 401);

    const secret = new TextEncoder().encode(required("MJCC_JWT_SECRET"));
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ sub: user.id, role: user.role, iat: now })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 12 * 60 * 60)
      .sign(secret);

    return json(req, {
      access_token: accessToken,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        last_name: user.last_name ?? "",
        role: user.role,
        active: user.active,
        ...credentialFlags(user),
      },
    });
  } catch (e) {
    console.error("pin_login_unhandled", e instanceof Error ? e.message : e);
    return json(req, { error: "PIN login is temporarily unavailable." }, 500);
  }
});
