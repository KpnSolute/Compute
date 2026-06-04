import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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


@app.get("/health")
async def health_check():
    return {"status": "ok"}


_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(_frontend_dist):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_frontend_dist, "assets")),
        name="assets",
    )

    @app.api_route("/", methods=["GET", "HEAD"])
    async def root():
        return FileResponse(os.path.join(_frontend_dist, "index.html"))

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        return FileResponse(os.path.join(_frontend_dist, "index.html"))
else:
    @app.api_route("/", methods=["GET", "HEAD"])
    async def root():
        return {"message": "Welcome to the MJCC API"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
