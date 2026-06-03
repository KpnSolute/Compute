from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from backend.routes import supabase, sessions

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str = ""
    pin: str = ""


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/login")
async def login(req: LoginRequest):
    result = (
        supabase.table("user_profiles")
        .select("*")
        .eq("username", req.username)
        .eq("active", True)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = result.data[0]

    if user["role"] in ("admin", "manager", "assistant"):
        if req.password != user.get("password", ""):
            raise HTTPException(status_code=401, detail="Invalid credentials")
    elif user["role"] == "staff":
        if req.pin != user.get("pin", ""):
            raise HTTPException(status_code=401, detail="Invalid credentials")
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = sessions.create(user)
    return LoginResponse(token=token, user=user)


@router.post("/logout")
async def logout(authorization: str = Header("")):
    token = authorization.replace("Bearer ", "") if authorization else ""
    sessions.delete(token)
    return {"message": "Logged out"}


@router.get("/me")
async def me(authorization: str = Header("")):
    token = authorization.replace("Bearer ", "") if authorization else ""
    user = sessions.get(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
