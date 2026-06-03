import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from backend.routes.auth import router as auth_router
from backend.routes.inventory import router as inventory_router
from backend.routes.logs import router as logs_router
from backend.routes.events import router as events_router
from backend.routes.menu import router as menu_router

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
app.include_router(inventory_router)
app.include_router(logs_router)
app.include_router(events_router)
app.include_router(menu_router)


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {"message": "Welcome to the MJCC API"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
