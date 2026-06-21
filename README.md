# 🛡️ CrowdSafe — Real-Time Stampede Prediction System

> A final year project for real-time crowd monitoring and stampede risk prediction using AI/ML, built for event organizers and volunteers to prevent crowd crush incidents like those seen at large public events in India.

---

## 📌 Table of Contents

- [Motivation](#motivation)
- [System Overview](#system-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Risk Classification](#risk-classification)
- [Installation](#installation)
- [Running the System](#running-the-system)
- [Default Credentials](#default-credentials)
- [API Reference](#api-reference)
- [Screenshots](#screenshots)
- [Future Improvements](#future-improvements)
- [Team](#team)

---

## Motivation

In recent years, India has witnessed several deadly stampede incidents at large public gatherings — including the RCB victory rally in Bengaluru and political events in Tamil Nadu — resulting in casualties that could have been prevented with timely intervention.

CrowdSafe addresses this by providing event organizers a real-time AI-powered monitoring system that:
- Tracks crowd density across multiple camera zones simultaneously
- Detects chaotic crowd movement using optical flow analysis
- Raises risk alerts at four escalating levels
- Instantly notifies field volunteers on their mobile phones when danger is imminent

---

## System Overview

```
CCTV / Webcam / Video Feed
         │
         ▼
  ┌─────────────────┐
  │  CSRNet Model   │  ← Crowd density estimation (people count + heatmap)
  └────────┬────────┘
           │
  ┌────────▼────────┐
  │  Optical Flow   │  ← Motion speed + chaos score (Farneback algorithm)
  └────────┬────────┘
           │
  ┌────────▼────────┐
  │ Risk Classifier │  ← Combines density + rate of change + motion chaos
  └────────┬────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Organizer     Volunteers
Dashboard     (mobile alert)
(WebSocket)   (WebSocket)
    │
    ▼
 SQLite DB
(logs critical alerts)
```

---

## Features

### Organizer Dashboard
- **Multi-camera grid** — monitor up to N zones simultaneously, each showing live video feed
- **Add cameras dynamically** — enter gate/zone name and start monitoring instantly
- **Overlay metrics** — risk badge, people count, crowd speed, chaos meter shown directly on each camera feed
- **Real-time density chart** — trend graph for the selected camera zone
- **Critical alert log** — history of Very High Risk events with timestamp, density, and chaos score
- **Volunteer management panel** — see all registered volunteers, who is online, activate/deactivate accounts
- **Profile settings** — change username and password
- **JWT-secured access** — admin-only login required

### Volunteer Alert Panel (Mobile-Friendly)
- **Register and login** — volunteers create their own account
- **Auto-reconnect** — stays connected even after phone screen locks or network drops
- **Instant alerts** — full-screen overlay with sound and vibration on High Alert or Very High Risk
- **Risk-specific messaging** — orange overlay for High Alert, red pulsing overlay for Very High Risk with specific action instructions
- **Alert history** — log of all alerts received in the current session
- **Acknowledge** — confirm alert received and return to standby
- **Test sound buttons** — verify alert sound works before the event
- **Profile settings** — change username and password

### AI/ML Core
- **CSRNet density estimation** — pretrained on ShanghaiTech dataset, handles dense/occluded crowds far better than bounding-box detectors
- **Optical flow (Farneback)** — computes per-pixel motion vectors between frames
- **Motion speed** — average crowd movement magnitude in pixels per frame
- **Chaos score** — circular variance of motion directions (0 = everyone moving same way, 1 = pure random chaos)
- **Configurable thresholds** — density, rate of change, chaos, and speed thresholds can be tuned per deployment

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| ML Model | CSRNet (pretrained, PyTorch) |
| Motion Analysis | OpenCV — Farneback dense optical flow |
| Backend | FastAPI (Python) |
| Real-time | WebSockets (FastAPI native) |
| Database | SQLite via SQLAlchemy |
| Authentication | JWT (python-jose) + bcrypt (passlib) |
| Frontend | React + Vite + Tailwind CSS |
| Charts | Recharts |
| Routing | React Router DOM (HashRouter) |
| Model Weights | Hugging Face Hub |

---

## Project Structure

```
Real-Time-Stampede-Detection/
│
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, all WebSocket endpoints
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── auth.py             # Login, register, change password/username
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   └── database.py         # SQLAlchemy models (User, AlertLog)
│   │   ├── ml/
│   │   │   ├── __init__.py
│   │   │   └── crowd_monitor.py    # CSRNet model, MotionAnalyzer, RiskClassifier
│   │   └── websocket/
│   │       ├── __init__.py
│   │       └── manager.py
│   ├── requirements.txt
│   └── stampede.db                 # Auto-created SQLite database
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Routing + auth guards
│   │   ├── index.css               # Tailwind import
│   │   ├── pages/
│   │   │   ├── AdminLogin.jsx      # Admin login page
│   │   │   ├── VolunteerAuth.jsx   # Volunteer register + login
│   │   │   ├── Dashboard.jsx       # Organizer multi-camera dashboard
│   │   │   └── VolunteerAlert.jsx  # Volunteer mobile alert panel
│   │   └── services/
│   │       └── auth.js             # Token management, API helpers
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

---

## How It Works

### 1. Density Estimation (CSRNet)
CrowdSafe uses **CSRNet** (Crowd Scene Recognition Network), a convolutional neural network pretrained on the ShanghaiTech crowd counting dataset. Unlike YOLO-based detection that draws bounding boxes, CSRNet outputs a **density map** — a heatmap where each pixel value represents the local crowd density. Summing the entire density map gives the estimated headcount.

This approach handles:
- Severe occlusion (people hidden behind others)
- Very high density where individuals are indistinguishable
- Varying camera angles and distances

### 2. Motion Analysis (Optical Flow)
Between consecutive frames, CrowdSafe computes **dense optical flow** using the Farneback algorithm. This gives a motion vector (speed + direction) for every pixel in the frame.

Two features are extracted:
- **Average Speed** — mean magnitude of all motion vectors. High values indicate rapid crowd movement.
- **Chaos Score** — circular variance of motion directions. If everyone moves in the same direction (e.g., exiting through a gate), chaos is low. If people are pushing in random directions (panic), chaos is high.

### 3. Risk Classification
The risk classifier combines all signals:

```
Risk = f(density, rate_of_change, avg_speed, chaos_score)
```

A rule-based classifier with configurable thresholds evaluates:
- Is density above the threshold?
- Is density increasing rapidly (rate of change)?
- Is crowd movement chaotic even at moderate density?
- Is crowd moving very fast?

Any combination that exceeds configured danger levels triggers the appropriate risk level.

### 4. Real-Time Communication
- Each camera connects via WebSocket to `/ws/camera/{id}` and streams JPEG frames
- Backend processes each frame and broadcasts results to all connected dashboards via `/ws/dashboard`
- Volunteers receive alerts via `/ws/volunteer/{username}` — only on High Alert and Very High Risk
- All WebSocket connections are JWT-authenticated

---

## Risk Classification

| Level | Color | Trigger Conditions | Volunteer Notified | Logged to DB |
|-------|-------|-------------------|-------------------|-------------|
| **No Risk** | 🟢 Green | Density < 650, chaos < 0.45, speed normal | ✗ | ✗ |
| **Medium Risk** | 🟡 Amber | Density ≥ 650 OR rate of change ≥ 15 OR chaos ≥ 0.45 | ✗ | ✗ |
| **High Alert** | 🟠 Orange | Density ≥ 750 OR rate ≥ 35 OR (density ≥ 650 AND chaos ≥ 0.65) OR speed ≥ 2.0 | ✅ (ring + vibrate) | ✗ |
| **Very High Risk** | 🔴 Red | Density ≥ 900 OR rate ≥ 60 OR (density ≥ 750 AND chaos ≥ 0.80) OR (speed ≥ 3.5 AND chaos ≥ 0.80) | ✅ (emergency alert) | ✅ |

> **Note:** Thresholds are calibrated based on the CSRNet model's output scale and can be adjusted in `crowd_monitor.py` per deployment scenario.

---

## Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- Git

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/Real-Time-Stampede-Detection.git
cd Real-Time-Stampede-Detection
```

### 2. Backend setup
```bash
cd backend

# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**`requirements.txt`**
```
fastapi
uvicorn[standard]
torch
torchvision
opencv-python
huggingface_hub
sqlalchemy
python-dotenv
websockets
numpy
python-jose[cryptography]
passlib[bcrypt]
python-multipart
```

### 3. Frontend setup
```bash
cd frontend
npm install
```

---

## Running the System

You need **two terminals** running simultaneously.

### Terminal 1 — Backend
```bash
cd backend
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

uvicorn app.main:app --reload
```

Expected output:
```
✓ Default admin created — username: admin | password: admin123
CSRNet model loaded successfully.
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

> The CSRNet weights (~60MB) are downloaded from Hugging Face on first run. Requires internet connection.

### Terminal 2 — Frontend
```bash
cd frontend
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in 300ms
  ➜  Local:   http://localhost:5173/
```

### Access the System

| URL | Purpose |
|-----|---------|
| `http://localhost:5173/#/` | Admin login |
| `http://localhost:5173/#/dashboard` | Organizer dashboard (admin only) |
| `http://localhost:5173/#/volunteer/login` | Volunteer register / login |
| `http://localhost:5173/#/volunteer` | Volunteer alert panel |
| `http://localhost:8000/docs` | FastAPI Swagger UI (API docs) |

---

## Default Credentials

On first startup, a default admin account is automatically created:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |
| Role | Admin |

**Change the password immediately after first login** via the ⚙️ profile button on the dashboard.

Volunteers register their own accounts at `/volunteer/login`.

---

## API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Admin or volunteer login | Public |
| POST | `/api/auth/register` | Volunteer registration | Public |
| GET | `/api/auth/me` | Get current user info | Bearer token |
| PATCH | `/api/auth/change-password` | Change password | Bearer token |
| PATCH | `/api/auth/change-username` | Change username | Bearer token |
| GET | `/api/auth/volunteers` | List all volunteers | Admin only |
| PATCH | `/api/auth/volunteers/{id}/toggle` | Activate/deactivate volunteer | Admin only |

### Alerts

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/alerts` | Get Very High Risk alert history | Bearer token |

### WebSockets

| Endpoint | Direction | Description | Auth |
|----------|-----------|-------------|------|
| `/ws/dashboard?token=` | Receive | All camera updates + volunteer list | Admin JWT |
| `/ws/camera/{id}?token=` | Send frames | Process crowd video frames | Admin JWT |
| `/ws/volunteer/{name}?token=` | Receive | High Alert + Very High Risk alerts only | Volunteer JWT |

---

## Future Improvements

- **RTSP/IP camera support** — connect directly to CCTV cameras over network instead of browser-captured video
- **Zone capacity configuration** — admin sets safe capacity per zone; thresholds auto-calibrate based on area size
- **Historical analytics dashboard** — charts showing alert frequency by hour/day/event
- **Event management** — create named events, assign cameras and volunteers to specific events
- **Heatmap overlay** — display CSRNet density map overlaid on live video feed
- **SMS/WhatsApp fallback** — send alerts via SMS if volunteer app is not open (Twilio integration)
- **Docker deployment** — single `docker-compose up` to run the entire system
- **Model fine-tuning** — fine-tune CSRNet on Indian crowd datasets for improved accuracy in local conditions

---

## Acknowledgements

- **CSRNet** — Li, Y. et al. "CSRNet: Dilated Convolutional Neural Networks for Understanding the Highly Congested Scenes." CVPR 2018.
- **ShanghaiTech Dataset** — Used for CSRNet pretraining
- **Pretrained weights** — [rootstrap-org/crowd-counting](https://huggingface.co/rootstrap-org/crowd-counting) on Hugging Face
- **OpenCV** — Optical flow implementation (Farneback algorithm)

---

## License

This project is developed as a Final Year Project for academic purposes.

---

*Built with ❤️ to make public events safer.*