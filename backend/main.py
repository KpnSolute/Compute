# ruff: noqa: E402
import logging
import os
import sys

# Configure root logging BEFORE any module-level `logging.getLogger(...)` calls
# happen on import (engine.py, data_entry.py, etc.) -- otherwise those loggers
# inherit the default WARNING level and every log.info()/log.warning() call
# (including AI request start/done lines and data-entry pipeline progress)
# is silently dropped and never reaches Render's log stream.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,  # Render captures stdout/stderr as the log stream
)
# Quiet noisy third-party libraries at INFO -- httpx/httpcore log every single
# outbound request line by line, which would drown out the [AI]/[DATA-ENTRY]
# lines we actually care about. Our own loggers (mjcc.*) stay at the level above.
for _noisy in (
    "httpx",
    "httpcore",
    "hpack",
    "supabase",
    "postgrest",
    "gotrue",
    "storage3",
):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from backend.routes.auth import router as auth_router
from backend.routes.users import router as users_router
from backend.routes.inventory import router as inventory_router
from backend.routes.logs import router as logs_router
from backend.routes.events import router as events_router
from backend.routes.menu import router as menu_router
from backend.routes.sourcectrl import router as sourcectrl_router
from backend.routes.github_sync import router as github_sync_router
from backend.routes.data import router as data_router
from backend.routes.data_entry import router as data_entry_router
from backend.routes.agent import router as agent_router
from backend.routes.sku_review import router as sku_review_router
from backend.routes.health import router as health_router
from backend.routes.health import collect_system_status, render_status_page
from fastapi.responses import HTMLResponse

load_dotenv()

app = FastAPI(title="MJCC API")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(inventory_router)
app.include_router(logs_router)
app.include_router(events_router)
app.include_router(menu_router)
app.include_router(sourcectrl_router)
app.include_router(github_sync_router)
app.include_router(data_router)
app.include_router(data_entry_router)
app.include_router(agent_router)
app.include_router(sku_review_router)
app.include_router(health_router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "MJCC Management API"}


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def root():
    return HTMLResponse(render_status_page(collect_system_status()))


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
