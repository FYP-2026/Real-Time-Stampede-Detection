from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from pydantic import BaseModel
from app.db.database import get_db, User

SECRET_KEY  = "crowdsafe-super-secret-key-change-in-production"
ALGORITHM   = "HS256"
TOKEN_HOURS = 24

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
router        = APIRouter(prefix="/api/auth", tags=["auth"])


def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_token(username: str, role: str) -> str:
    payload = {
        "sub":  username,
        "role": role,
        "exp":  datetime.utcnow() + timedelta(hours=TOKEN_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_token(token)
    user    = db.query(User).filter(User.username == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user

def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Schemas ──────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    email:    str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    role:         str
    username:     str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

class ChangeUsernameRequest(BaseModel):
    new_username: str
    password:     str


# ── Auth Endpoints ────────────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    return TokenResponse(
        access_token=create_token(user.username, user.role),
        role=user.role,
        username=user.username
    )


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
        role="volunteer"
    )
    db.add(user)
    db.commit()
    return TokenResponse(
        access_token=create_token(user.username, "volunteer"),
        role="volunteer",
        username=user.username
    )


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "username":   current_user.username,
        "email":      current_user.email,
        "role":       current_user.role,
        "created_at": current_user.created_at.isoformat()
    }


@router.patch("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    current_user.hashed_password = hash_password(req.new_password)
    db.commit()
    return {"message": "Password changed successfully"}


@router.patch("/change-username")
def change_username(
    req: ChangeUsernameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(req.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    if db.query(User).filter(User.username == req.new_username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    current_user.username = req.new_username
    db.commit()
    new_token = create_token(req.new_username, current_user.role)
    return TokenResponse(
        access_token=new_token,
        role=current_user.role,
        username=req.new_username
    )


@router.get("/volunteers", dependencies=[Depends(require_admin)])
def list_volunteers(db: Session = Depends(get_db)):
    volunteers = db.query(User).filter(User.role == "volunteer").all()
    return [
        {
            "id":         v.id,
            "username":   v.username,
            "email":      v.email,
            "is_active":  v.is_active,
            "created_at": v.created_at.isoformat()
        }
        for v in volunteers
    ]


@router.patch("/volunteers/{user_id}/toggle", dependencies=[Depends(require_admin)])
def toggle_volunteer(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    user.is_active = not user.is_active
    db.commit()
    return {"username": user.username, "is_active": user.is_active}