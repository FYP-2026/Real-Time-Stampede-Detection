from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
import cv2, numpy as np, datetime

from app.ml.crowd_monitor import load_model, estimate_density, RiskClassifier, MotionAnalyzer
from app.db.database import init_db, get_db, AlertLog, User
from app.api.auth import (
    router as auth_router, hash_password,
    SECRET_KEY, ALGORITHM
)

app = FastAPI(title="Stampede Prediction System")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_router)

model             = None
camera_processors = {}
dashboard_clients = []
active_volunteers = {}   # username -> WebSocket


def seed_admin(db: Session):
    """Create default admin account if none exists."""
    if not db.query(User).filter(User.role == "admin").first():
        admin = User(
            username="admin",
            email="admin@crowdsafe.com",
            hashed_password=hash_password("admin123"),
            role="admin"
        )
        db.add(admin)
        db.commit()
        print("✓ Default admin created — username: admin | password: admin123")
        print("  ⚠ Please change the password after first login!")


@app.on_event("startup")
def startup_event():
    global model
    init_db()
    db = next(get_db())
    seed_admin(db)
    model = load_model()
    print("Model loaded and DB initialized.")


# ── REST Endpoints ────────────────────────────────────────────────────
@app.get("/api/alerts")
def get_alerts(limit: int = 100, db: Session = Depends(get_db)):
    alerts = db.query(AlertLog).order_by(AlertLog.timestamp.desc()).limit(limit).all()
    return [
        {
            "id":             a.id,
            "timestamp":      a.timestamp.isoformat(),
            "camera_id":      a.camera_id,
            "density":        a.density,
            "rate_of_change": a.rate_of_change,
            "risk_level":     a.risk_level,
        }
        for a in alerts
    ]


@app.get("/api/active-volunteers")
def get_active_volunteers():
    return {"volunteers": list(active_volunteers.keys())}


async def push_volunteer_list():
    vol_list = list(active_volunteers.keys())
    dead = []
    for client in dashboard_clients:
        try:
            await client.send_json({"type": "volunteers", "volunteers": vol_list})
        except:
            dead.append(client)
    for d in dead:
        if d in dashboard_clients:
            dashboard_clients.remove(d)


# ── WebSocket Auth Helpers ────────────────────────────────────────────
def verify_ws_token(token: str, required_role: str = None) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if required_role and payload.get("role") != required_role:
            return None
        return payload
    except JWTError:
        return None


# ── Dashboard WebSocket (admin only) ─────────────────────────────────
@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket, token: str = Query(...)):
    payload = verify_ws_token(token, required_role="admin")
    if not payload:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    dashboard_clients.append(websocket)
    await websocket.send_json({"type": "volunteers", "volunteers": list(active_volunteers.keys())})

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in dashboard_clients:
            dashboard_clients.remove(websocket)


# ── Volunteer WebSocket (volunteer only) ─────────────────────────────
@app.websocket("/ws/volunteer/{vol_name}")
async def volunteer_ws(websocket: WebSocket, vol_name: str, token: str = Query(...)):
    payload = verify_ws_token(token, required_role="volunteer")
    if not payload or payload.get("sub") != vol_name:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    active_volunteers[vol_name] = websocket
    await push_volunteer_list()

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_volunteers.pop(vol_name, None)
        await push_volunteer_list()


# ── Camera WebSocket ──────────────────────────────────────────────────
@app.websocket("/ws/camera/{camera_id}")
async def camera_ws(websocket: WebSocket, camera_id: str, token: str = Query(...)):
    payload = verify_ws_token(token, required_role="admin")
    if not payload:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    if camera_id not in camera_processors:
        camera_processors[camera_id] = {
            "classifier": RiskClassifier(),
            "motion":     MotionAnalyzer()
        }

    proc = camera_processors[camera_id]
    db   = next(get_db())

    try:
        while True:
            data   = await websocket.receive_bytes()
            np_arr = np.frombuffer(data, np.uint8)
            frame  = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            count  = estimate_density(model, frame)
            motion = proc["motion"].analyze(frame)
            result = proc["classifier"].update(count, motion=motion)

            result["camera_id"] = camera_id
            result["timestamp"] = datetime.datetime.utcnow().isoformat()
            result["type"]      = "camera_update"

            # Broadcast to dashboards
            dead = []
            for client in dashboard_clients:
                try:
                    await client.send_json(result)
                except:
                    dead.append(client)
            for d in dead:
                if d in dashboard_clients:
                    dashboard_clients.remove(d)

            # Log only Very High Risk
            if result["risk"] == "Very High Risk":
                log = AlertLog(
                    camera_id=camera_id,
                    density=result["density"],
                    rate_of_change=result["rate_of_change"],
                    risk_level=result["risk"]
                )
                db.add(log)
                db.commit()

            # Notify volunteers on High Alert + Very High Risk
            if result["risk"] in ("High Alert", "Very High Risk"):
                dead_vols = []
                for vol_name, vol_ws in active_volunteers.items():
                    try:
                        await vol_ws.send_json(result)
                    except:
                        dead_vols.append(vol_name)
                for v in dead_vols:
                    active_volunteers.pop(v, None)

    except WebSocketDisconnect:
        pass
    finally:
        db.close()