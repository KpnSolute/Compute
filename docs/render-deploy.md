# Render Manual Deploy Guide (No Blueprint)

This guide covers setting up MJCC on Render's free tier using a Web Service backed by
Docker. Do not use the `render.yaml` Blueprint — follow these steps manually in the
Render dashboard.

## 1. Create a new Web Service

1. Log in to the Render dashboard and click **New > Web Service**.
2. Connect the **KpnWorld/MJCC** GitHub repository.
3. Under **Environment**, select **Docker**.
4. Set the following Docker settings:
   - **Dockerfile path:** `./Dockerfile`
   - **Docker context:** `.`
5. Leave the **Docker command** field blank — the `CMD` in the Dockerfile is used.

## 2. Free tier limits

| Resource             | Free tier                      |
| -------------------- | ------------------------------ |
| RAM                  | 512 MB                         |
| CPU                  | 0.1 vCPU                       |
| Inactivity spin-down | After 15 minutes of no traffic |

The gunicorn configuration uses `--workers 2 --preload` to stay within the 512 MB RAM
budget. `--preload` loads the Flask application once in the master process and forks into
workers, so the keep-alive background thread is started a single time and shared — it
does not spawn an extra thread per worker.

Render injects the `PORT` environment variable at runtime. The CMD binds to
`${PORT:-5000}`, so no manual port setting is needed.

## 3. Health check

Set the health check path in the Render service settings to:

```
/ping
```

Render will GET this path periodically. The route must return a 2xx response.

## 4. Required environment variables

Set these in **Environment > Environment Variables** in the Render service settings.
Never commit these values to the repository.

| Variable               | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `SECRET_KEY`           | Flask session secret — use a long random string                      |
| `SUPABASE_URL`         | Supabase project URL (e.g., `https://<ref>.supabase.co`)             |
| `SUPABASE_ANON_KEY`    | Supabase public anon key                                             |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (privileged — keep secret)                 |
| `CORS_ORIGINS`         | Comma-separated list of allowed origins (e.g., your frontend domain) |
| `FLASK_ENV`            | Set to `production`                                                  |
| `LOG_LEVEL`            | Set to `WARNING` to reduce log noise on the free tier                |
| `AI_PROVIDER`          | `groq` or `gemini` — Ollama is local-only and not valid here         |
| `AI_MODEL`             | Model name to use with the selected provider                         |
| `GROQ_API_KEY`         | API key for Groq (required when `AI_PROVIDER=groq`)                  |
| `GROQ_MODEL`           | Groq model name override (optional if `AI_MODEL` is set)             |

Render automatically sets `RENDER_EXTERNAL_URL` to the public URL of the service. The
application's keep-alive background thread reads this variable to ping the service and
prevent it from spinning down during active use periods.

## 5. Deploy

After saving all environment variables, click **Manual Deploy > Deploy latest commit**.
Monitor the build logs to confirm the image builds and the container starts cleanly. Once
the health check at `/ping` returns 200, the service is live.
