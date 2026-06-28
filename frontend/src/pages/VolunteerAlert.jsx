import { useEffect, useRef, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { authService } from "../services/auth"

const ALERT_CONFIG = {
  "High Alert": {
    bg: "bg-orange-950", border: "border-orange-500", text: "text-orange-300",
    overlayBg: "bg-orange-950",
    emoji: "⚠️", title: "HIGH ALERT",
    msg: "Crowd density is high. Move to your assigned position and monitor exits.",
    vibrate: [200, 100, 200, 100, 200],
    freq: [660, 660, 880],
  },
  "Very High Risk": {
    bg: "bg-red-950", border: "border-red-500", text: "text-red-300",
    overlayBg: "bg-red-950",
    emoji: "🚨", title: "STAMPEDE RISK!",
    msg: "OPEN ALL EXITS IMMEDIATELY. Guide crowd out calmly. Do NOT panic.",
    vibrate: [400, 150, 400, 150, 600],
    freq: [880, 880, 1100],
  }
}

// Shared AudioContext — prevents "rings once" bug
let sharedAudioCtx = null
function getAudioCtx() {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return sharedAudioCtx
}

async function playAlertSound(risk) {
  try {
    const ctx   = getAudioCtx()
    if (ctx.state === "suspended") await ctx.resume()
    const freqs = ALERT_CONFIG[risk]?.freq || [660, 660, 880]
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = f
      o.type = "square"
      const t = ctx.currentTime + i * 0.35
      g.gain.setValueAtTime(0.4, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.start(t); o.stop(t + 0.3)
    })
    if (navigator.vibrate) navigator.vibrate(ALERT_CONFIG[risk]?.vibrate || [300, 100, 300])
  } catch (e) {
    console.warn("Audio error:", e)
  }
}

export default function VolunteerAlert() {
  const navigate = useNavigate()
  const user     = authService.getUser()

  const [connected,   setConnected]   = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [alertCams,   setAlertCams]   = useState({})   // camId → { density, risk }
  const [history,     setHistory]     = useState([])
  const [showProfile, setShowProfile] = useState(false)

  // Profile state
  const [profileTab,  setProfileTab]  = useState("password")
  const [curPassword, setCurPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newUsername, setNewUsername] = useState("")
  const [unPassword,  setUnPassword]  = useState("")
  const [profileMsg,  setProfileMsg]  = useState(null)

  const wsRef               = useRef(null)
  const shouldReconnect     = useRef(true)
  const reconnectTimer      = useRef(null)
  const ringIntervalRef     = useRef(null)
  const isRingingRef        = useRef(false)
  const currentRiskRef      = useRef("No Risk")

  // Tracks whether risk has dropped below High Alert since last acknowledge.
  // Only when this is true will a new High/VeryHigh alert re-trigger the overlay.
  const clearedSinceAckRef  = useRef(true)

  // ── Ringing control ─────────────────────────────────────────────
  const startRinging = useCallback((risk) => {
    if (isRingingRef.current) return
    isRingingRef.current = true
    playAlertSound(risk)
    ringIntervalRef.current = setInterval(() => {
      if (isRingingRef.current) playAlertSound(risk)
    }, 4000)
  }, [])

  const stopRinging = useCallback(() => {
    isRingingRef.current = false
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current)
      ringIntervalRef.current = null
    }
  }, [])

  // ── WebSocket with auto-reconnect ────────────────────────────────
  function connect() {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)

    const ws = new WebSocket(authService.wsUrl(`/ws/volunteer/${user.username}`))
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping")
        else clearInterval(ping)
      }, 25000)
    }

    ws.onclose = () => {
      setConnected(false)
      if (shouldReconnect.current) {
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => ws.close()

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const { camera_id, risk, density, timestamp } = data

        // ── Risk dropped below High Alert ──────────────────────────
        if (!["High Alert", "Very High Risk"].includes(risk)) {
          currentRiskRef.current = risk
          // Mark that risk cleared — next escalation will re-trigger
          clearedSinceAckRef.current = true
          setAlertCams(prev => {
            const next = { ...prev }
            delete next[camera_id]
            return next
          })
          return
        }

        // ── High Alert or Very High Risk received ──────────────────
        currentRiskRef.current = risk

        setAlertCams(prev => ({ ...prev, [camera_id]: { density, risk } }))
        setHistory(prev => [{
          camera_id, risk, density,
          time: new Date(timestamp).toLocaleTimeString()
        }, ...prev].slice(0, 30))

        // Only trigger overlay + ringing if risk has cleared since last ack
        if (clearedSinceAckRef.current) {
          clearedSinceAckRef.current = false   // won't re-trigger until risk drops again
          setShowOverlay(true)
          startRinging(risk)

          if (Notification.permission === "granted") {
            new Notification(
              `${risk === "Very High Risk" ? "🚨" : "⚠️"} ${risk} — ${camera_id}`,
              { body: `Crowd density: ${density} p/m². ${ALERT_CONFIG[risk]?.msg}` }
            )
          }
        }
      } catch (err) {
        console.error("Failed to parse volunteer message:", err)
      }
    }

    Notification.requestPermission()
  }

  useEffect(() => {
    shouldReconnect.current = true
    connect()
    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current)
      wsRef.current?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function acknowledge() {
    setShowOverlay(false)
    stopRinging()
    // Do NOT clear alertCams or clearedSinceAckRef here —
    // clearedSinceAckRef only resets when risk actually drops below High Alert.
    // This means if risk stays High, no re-trigger until it drops and comes back.
  }

  function logout() {
    shouldReconnect.current = false
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    stopRinging()
    wsRef.current?.close()
    authService.clearSession()
    navigate("/volunteer/login")
  }

  // ── Profile actions ──────────────────────────────────────────────
  async function changePassword(e) {
    e.preventDefault(); setProfileMsg(null)
    if (newPassword.length < 6) {
      setProfileMsg({ type: "error", text: "Min 6 characters" }); return
    }
    try {
      const res  = await fetch("http://localhost:8000/api/auth/change-password", {
        method: "PATCH", headers: authService.headers(),
        body: JSON.stringify({ current_password: curPassword, new_password: newPassword })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setProfileMsg({ type: "success", text: "Password changed successfully!" })
      setCurPassword(""); setNewPassword("")
    } catch (err) { setProfileMsg({ type: "error", text: err.message }) }
  }

  async function changeUsername(e) {
    e.preventDefault(); setProfileMsg(null)
    try {
      const res  = await fetch("http://localhost:8000/api/auth/change-username", {
        method: "PATCH", headers: authService.headers(),
        body: JSON.stringify({ new_username: newUsername, password: unPassword })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      authService.setSession(data.access_token, { username: data.username, role: data.role })
      setProfileMsg({ type: "success", text: "Username updated. Please log in again." })
      setTimeout(() => { authService.clearSession(); navigate("/volunteer/login") }, 2000)
    } catch (err) { setProfileMsg({ type: "error", text: err.message }) }
  }

  // Derived
  const activeAlerts = Object.entries(alertCams)
  const worstRisk    = activeAlerts.some(([, c]) => c.risk === "Very High Risk")
    ? "Very High Risk" : "High Alert"
  const alertCfg     = ALERT_CONFIG[worstRisk] || ALERT_CONFIG["High Alert"]
  const hasActiveAlert = activeAlerts.length > 0

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono">

      {/* ── Full-Screen Alert Overlay ─────────────────────────────── */}
      {showOverlay && (
        <div className={`fixed inset-0 z-50 ${alertCfg.overlayBg} flex flex-col items-center justify-center p-6 text-center
          ${worstRisk === "Very High Risk" ? "animate-pulse" : ""}`}>

          <div className="text-8xl mb-4">{alertCfg.emoji}</div>
          <h1 className={`text-4xl font-black tracking-wider mb-2 ${alertCfg.text}`}>
            {alertCfg.title}
          </h1>
          <p className="text-sm text-gray-200 mb-6 leading-relaxed max-w-xs">{alertCfg.msg}</p>

          {/* Affected cameras */}
          <div className="w-full max-w-xs space-y-2 mb-6">
            {activeAlerts.map(([camId, cam]) => {
              const cfg = ALERT_CONFIG[cam.risk]
              return (
                <div key={camId} className={`border ${cfg?.border} rounded-2xl px-5 py-3 bg-black/30`}>
                  <div className="flex items-center justify-between">
                    <p className="text-base font-black text-white">{camId}</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg?.text} border ${cfg?.border}`}>
                      {cam.risk}
                    </span>
                  </div>
                  <p className="text-3xl font-black mt-1" style={{ color: cam.risk === "Very High Risk" ? "#fca5a5" : "#fed7aa" }}>
                    {typeof cam.density === "number" ? cam.density.toFixed(2) : cam.density}
                    <span className="text-sm font-normal text-gray-400 ml-1">p/m²</span>
                  </p>
                </div>
              )
            })}
          </div>

          {/* Ringing indicator */}
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span className="text-xs text-gray-300">Alert ringing continuously — acknowledge to stop</span>
          </div>

          {/* Acknowledge button */}
          <button onClick={acknowledge}
            className="bg-white text-gray-950 font-black text-sm px-10 py-4 rounded-2xl tracking-widest w-full max-w-xs active:scale-95 transition-transform">
            ✓ ACKNOWLEDGED — STOP ALERT
          </button>
        </div>
      )}

      {/* ── Profile Modal ────────────────────────────────────────── */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowProfile(false); setProfileMsg(null) }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-black tracking-widest uppercase">⚙️ Profile Settings</h2>
              <button onClick={() => { setShowProfile(false); setProfileMsg(null) }}
                className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="flex bg-gray-800 rounded-xl p-1 mb-5">
              <button onClick={() => { setProfileTab("password"); setProfileMsg(null) }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${profileTab === "password" ? "bg-emerald-700 text-white" : "text-gray-500"}`}>
                Change Password
              </button>
              <button onClick={() => { setProfileTab("username"); setProfileMsg(null) }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${profileTab === "username" ? "bg-blue-700 text-white" : "text-gray-500"}`}>
                Change Username
              </button>
            </div>
            {profileMsg && (
              <div className={`mb-4 px-4 py-3 rounded-xl text-xs border ${profileMsg.type === "success" ? "bg-emerald-950 border-emerald-800 text-emerald-400" : "bg-red-950 border-red-800 text-red-400"}`}>
                {profileMsg.text}
              </div>
            )}
            {profileTab === "password" && (
              <form onSubmit={changePassword} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">Current Password</label>
                  <input type="password" value={curPassword} onChange={e => setCurPassword(e.target.value)} required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required
                    placeholder="Min 6 characters"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
                </div>
                <button type="submit" className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-sm py-2.5 rounded-xl">
                  Update Password
                </button>
              </form>
            )}
            {profileTab === "username" && (
              <form onSubmit={changeUsername} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">New Username</label>
                  <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required
                    placeholder="Choose a new username"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">Confirm with Password</label>
                  <input type="password" value={unPassword} onChange={e => setUnPassword(e.target.value)} required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <button type="submit" className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold text-sm py-2.5 rounded-xl">
                  Update Username
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Standby Screen ──────────────────────────────────────────── */}
      <div className="max-w-sm mx-auto p-5">

        {/* Header */}
        <div className="flex items-center justify-between py-4 mb-5">
          <div>
            <h1 className="text-sm font-black tracking-widest">🛡️ CROWDSAFE</h1>
            <p className="text-xs text-gray-500">
              <span className="text-white font-bold">{user?.username}</span>
              <span className="text-gray-600"> · Volunteer</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`}></span>
              <span className="text-xs text-gray-500">{connected ? "Live" : "Reconnecting..."}</span>
            </div>
            <button onClick={() => setShowProfile(true)}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded-lg transition-all">
              ⚙️
            </button>
            <button onClick={logout}
              className="text-xs text-red-400 border border-red-900 hover:border-red-700 px-2 py-1 rounded-lg transition-all">
              Logout
            </button>
          </div>
        </div>

        {/* Status card */}
        {hasActiveAlert && !showOverlay ? (
          // Alert received but acknowledged — show compact warning
          <div className={`border-2 ${ALERT_CONFIG[worstRisk]?.border} rounded-3xl p-6 text-center mb-5 bg-gray-900`}>
            <div className="text-4xl mb-2">{ALERT_CONFIG[worstRisk]?.emoji}</div>
            <p className={`text-lg font-black ${ALERT_CONFIG[worstRisk]?.text} mb-1`}>
              {worstRisk} — ACKNOWLEDGED
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Alert will re-trigger if risk drops and rises again.
            </p>
            <button onClick={() => { setShowOverlay(true); startRinging(worstRisk) }}
              className={`text-xs border ${ALERT_CONFIG[worstRisk]?.border} ${ALERT_CONFIG[worstRisk]?.text} px-4 py-2 rounded-xl`}>
              View Alert Again
            </button>
          </div>
        ) : (
          // All clear
          <div className="bg-emerald-950/30 border border-emerald-900 rounded-3xl p-8 text-center mb-5">
            <div className="text-6xl mb-3">✅</div>
            <p className="text-xl font-black text-emerald-400">ALL CLEAR</p>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              Alert rings continuously on <span className="text-orange-400">High Alert</span> and{" "}
              <span className="text-red-400">Very High Risk</span>.<br />
              Acknowledge to stop. Re-triggers after risk clears and rises again.
            </p>
          </div>
        )}

        {/* Test buttons */}
        <div className="flex gap-2 mb-5">
          <button onClick={() => playAlertSound("High Alert")}
            className="flex-1 bg-orange-900/50 border border-orange-800 text-orange-400 text-xs font-bold py-2.5 rounded-xl active:scale-95 transition-all">
            ⚠️ Test Sound
          </button>
          <button onClick={() => playAlertSound("Very High Risk")}
            className="flex-1 bg-red-900/50 border border-red-800 text-red-400 text-xs font-bold py-2.5 rounded-xl active:scale-95 transition-all">
            🚨 Test Critical
          </button>
        </div>

        {/* Alert history */}
        <p className="text-xs text-gray-600 uppercase tracking-widest mb-3">Alert History</p>
        <div className="bg-gray-900 rounded-2xl overflow-hidden">
          {history.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-8">No alerts this session</p>
          ) : history.map((a, i) => {
            const cfg = ALERT_CONFIG[a.risk]
            return (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-gray-800 last:border-0">
                <div>
                  <p className={`text-sm font-bold ${cfg?.text || "text-gray-400"}`}>{a.camera_id}</p>
                  <p className="text-xs text-gray-500">{a.risk} · {a.time}</p>
                </div>
                <p className="text-sm font-black text-white">
                  {typeof a.density === "number" ? a.density.toFixed(2) : a.density} p/m²
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}