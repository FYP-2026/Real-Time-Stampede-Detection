import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import axios from "axios"
import { authService } from "../services/auth"

const RISK_CONFIG = {
  "No Risk":        { text: "text-emerald-400", border: "border-emerald-600", dot: "bg-emerald-400", badge: "bg-emerald-950/90 text-emerald-300", priority: 0 },
  "Medium Risk":    { text: "text-amber-400",   border: "border-amber-500",   dot: "bg-amber-400",   badge: "bg-amber-950/90 text-amber-300",   priority: 1 },
  "High Alert":     { text: "text-orange-400",  border: "border-orange-500",  dot: "bg-orange-500",  badge: "bg-orange-950/90 text-orange-300", priority: 2 },
  "Very High Risk": { text: "text-red-400",     border: "border-red-500",     dot: "bg-red-500",     badge: "bg-red-950/90 text-red-300",       priority: 3 },
}
const PRIORITY    = { "No Risk": 0, "Medium Risk": 1, "High Alert": 2, "Very High Risk": 3 }
const CHART_COLOR = { "No Risk": "#10b981", "Medium Risk": "#f59e0b", "High Alert": "#f97316", "Very High Risk": "#ef4444" }

const DEFAULT_CAMERAS = [
  { id: "MAIN-GATE",     name: "Main Gate"     },
  { id: "EAST-ENTRANCE", name: "East Entrance" },
]

const initState = (cameras) =>
  Object.fromEntries(cameras.map(c => [c.id, {
    risk: "No Risk", density: 0, rate_of_change: 0,
    avg_speed: 0, chaos_score: 0, active: false
  }]))

export default function Dashboard() {
  const navigate = useNavigate()
  const user     = authService.getUser()

  // ── Camera state ─────────────────────────────────────────────────
  const [cameras,       setCameras]       = useState(DEFAULT_CAMERAS)
  const [camStates,     setCamStates]     = useState(initState(DEFAULT_CAMERAS))
  const [selected,      setSelected]      = useState("MAIN-GATE")
  const [history,       setHistory]       = useState({})
  const [logs,          setLogs]          = useState([])
  const [volunteers,    setVolunteers]    = useState([])
  const [allVolunteers, setAllVolunteers] = useState([])
  const [connected,     setConnected]     = useState(false)

  // ── UI toggles ───────────────────────────────────────────────────
  const [showModal,     setShowModal]     = useState(false)
  const [showVolPanel,  setShowVolPanel]  = useState(false)
  const [showProfile,   setShowProfile]   = useState(false)
  const [newCamName,    setNewCamName]    = useState("")

  // ── Profile form ─────────────────────────────────────────────────
  const [profileTab,    setProfileTab]    = useState("password")
  const [curPassword,   setCurPassword]   = useState("")
  const [newPassword,   setNewPassword]   = useState("")
  const [newUsername,   setNewUsername]   = useState("")
  const [unPassword,    setUnPassword]    = useState("")
  const [profileMsg,    setProfileMsg]    = useState(null)  // { type, text }

  // ── Refs ─────────────────────────────────────────────────────────
  const cameraWsRefs = useRef({})
  const videoRefs    = useRef({})
  const intervalRefs = useRef({})

  // ── Dashboard WebSocket ───────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(authService.wsUrl("/ws/dashboard"))

    ws.onopen = () => {
      setConnected(true)
      setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25000)
    }
    ws.onclose  = () => setConnected(false)
    ws.onerror  = () => setConnected(false)

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.type === "volunteers") {
        setVolunteers(data.volunteers)
        return
      }

      if (data.type === "camera_update") {
        const { camera_id, risk, density, rate_of_change, avg_speed, chaos_score, timestamp } = data
        setCamStates(prev => ({
          ...prev,
          [camera_id]: { ...prev[camera_id], risk, density, rate_of_change, avg_speed, chaos_score }
        }))
        setHistory(prev => ({
          ...prev,
          [camera_id]: [
            ...(prev[camera_id] || []),
            { time: new Date(timestamp).toLocaleTimeString(), density }
          ].slice(-30)
        }))
        if (risk === "Very High Risk") {
          setLogs(prev => [
            { camera_id, risk, density, avg_speed, chaos_score, timestamp },
            ...prev
          ].slice(0, 100))
        }
      }
    }

    const headers = authService.headers()
    axios.get("/api/alerts", { headers }).then(r =>
      setLogs(r.data.map(a => ({
        camera_id: a.camera_id, risk: a.risk_level,
        density: a.density, timestamp: a.timestamp
      })))
    )
    axios.get("/api/auth/volunteers", { headers })
      .then(r => setAllVolunteers(r.data))

    return () => ws.close()
  }, [])

  // ── Auth actions ──────────────────────────────────────────────────
  function logout() {
    Object.values(cameraWsRefs.current).forEach(ws => ws?.close())
    Object.values(intervalRefs.current).forEach(clearInterval)
    authService.clearSession()
    navigate("/")
  }

  async function changePassword(e) {
    e.preventDefault()
    setProfileMsg(null)
    if (newPassword.length < 6) {
      setProfileMsg({ type: "error", text: "New password must be at least 6 characters" })
      return
    }
    try {
      const res  = await fetch("http://localhost:8000/api/auth/change-password", {
        method:  "PATCH",
        headers: authService.headers(),
        body:    JSON.stringify({ current_password: curPassword, new_password: newPassword })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setProfileMsg({ type: "success", text: "Password changed successfully!" })
      setCurPassword(""); setNewPassword("")
    } catch (err) {
      setProfileMsg({ type: "error", text: err.message })
    }
  }

  async function changeUsername(e) {
    e.preventDefault()
    setProfileMsg(null)
    try {
      const res  = await fetch("http://localhost:8000/api/auth/change-username", {
        method:  "PATCH",
        headers: authService.headers(),
        body:    JSON.stringify({ new_username: newUsername, password: unPassword })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      authService.setSession(data.access_token, { username: data.username, role: data.role })
      setProfileMsg({ type: "success", text: "Username updated! Refreshing..." })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setProfileMsg({ type: "error", text: err.message })
    }
  }

  // ── Camera management ─────────────────────────────────────────────
  function addCamera() {
    const name = newCamName.trim()
    if (!name) return
    const id = name.toUpperCase().replace(/\s+/g, "-")
    if (cameras.find(c => c.id === id)) return
    setCameras(prev => [...prev, { id, name }])
    setCamStates(prev => ({
      ...prev,
      [id]: { risk: "No Risk", density: 0, rate_of_change: 0, avg_speed: 0, chaos_score: 0, active: false }
    }))
    setNewCamName("")
    setShowModal(false)
  }

  function removeCamera(camId) {
    stopCamera(camId)
    setCameras(prev => prev.filter(c => c.id !== camId))
    if (selected === camId) setSelected(cameras[0]?.id)
  }

  async function startCamera(camId, videoFile) {
    const video = videoRefs.current[camId]
    if (!video) return

    if (videoFile) {
      video.src = URL.createObjectURL(videoFile)
      video.loop = true
      video.play()
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        video.srcObject = stream
      } catch {
        alert("Camera access denied.")
        return
      }
    }

    const ws = new WebSocket(authService.wsUrl(`/ws/camera/${camId}`))
    cameraWsRefs.current[camId] = ws

    ws.onopen = () => {
      intervalRefs.current[camId] = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        const canvas = document.createElement("canvas")
        canvas.width = 320; canvas.height = 240
        canvas.getContext("2d").drawImage(video, 0, 0, 320, 240)
        canvas.toBlob(
          blob => blob?.arrayBuffer().then(buf => ws.send(buf)),
          "image/jpeg", 0.7
        )
      }, 1000)
    }

    setCamStates(prev => ({ ...prev, [camId]: { ...prev[camId], active: true } }))
  }

  function stopCamera(camId) {
    clearInterval(intervalRefs.current[camId])
    const ws = cameraWsRefs.current[camId]
    if (ws) { ws.close(); delete cameraWsRefs.current[camId] }
    const video = videoRefs.current[camId]
    if (video) {
      if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop())
      video.srcObject = null; video.src = ""
    }
    setCamStates(prev => ({
      ...prev,
      [camId]: { ...prev[camId], active: false, risk: "No Risk", density: 0, avg_speed: 0, chaos_score: 0 }
    }))
  }

  async function toggleVolunteer(id) {
    await axios.patch(`/api/auth/volunteers/${id}/toggle`, {}, { headers: authService.headers() })
    const res = await axios.get("/api/auth/volunteers", { headers: authService.headers() })
    setAllVolunteers(res.data)
  }

  // ── Derived values ────────────────────────────────────────────────
  const worstRisk = Object.values(camStates)
    .reduce((w, c) => PRIORITY[c.risk] > PRIORITY[w] ? c.risk : w, "No Risk")
  const wcfg    = RISK_CONFIG[worstRisk]
  const selState = camStates[selected] || { risk: "No Risk", density: 0, rate_of_change: 0, avg_speed: 0, chaos_score: 0 }
  const selName  = cameras.find(c => c.id === selected)?.name || selected

  const chaosLabel = (s) => s > 0.75 ? "CHAOTIC" : s > 0.5 ? "MIXED" : s > 0.3 ? "ACTIVE" : "CALM"
  const chaosColor = (s) => s > 0.75 ? "#ef4444" : s > 0.5 ? "#f97316" : s > 0.3 ? "#f59e0b" : "#10b981"
  const chaosText  = (s) => s > 0.75 ? "text-red-400" : s > 0.5 ? "text-orange-400" : s > 0.3 ? "text-amber-400" : "text-emerald-400"
  const speedText  = (s) => s > 3 ? "text-red-400" : s > 1.5 ? "text-amber-400" : "text-emerald-400"

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <div>
            <h1 className="text-sm font-black tracking-widest uppercase">CrowdSafe</h1>
            <p className="text-xs text-gray-500">Multi-Zone Stampede Prediction</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Overall risk badge */}
          <div className={`px-4 py-1.5 rounded-full border ${wcfg.border} flex items-center gap-2 ${worstRisk === "Very High Risk" ? "animate-pulse" : ""}`}>
            <span className={`w-2 h-2 rounded-full ${wcfg.dot}`}></span>
            <span className={`text-xs font-bold tracking-widest ${wcfg.text}`}>{worstRisk.toUpperCase()}</span>
          </div>

          <button onClick={() => setShowModal(true)}
            className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-bold transition-all">
            + Add Camera
          </button>

          <button onClick={() => setShowVolPanel(v => !v)}
            className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-bold transition-all">
            👥 Volunteers
          </button>

          {/* Connection status */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`}></span>
            <span className="text-gray-400">{connected ? "LIVE" : "OFFLINE"}</span>
          </div>

          {/* Admin profile + logout */}
          <div className="flex items-center gap-2 border-l border-gray-800 pl-3">
            <button
              onClick={() => { setShowProfile(true); setProfileMsg(null) }}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-lg transition-all">
              👤 {user?.username}
            </button>
            <button onClick={logout}
              className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-2 py-1 rounded-lg transition-all">
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Camera Grid ─────────────────────────────────────────── */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            {cameras.map(cam => {
              const state = camStates[cam.id] || { risk: "No Risk", density: 0, rate_of_change: 0, avg_speed: 0, chaos_score: 0, active: false }
              const cfg   = RISK_CONFIG[state.risk]

              return (
                <div key={cam.id} onClick={() => setSelected(cam.id)}
                  className={`rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-300 bg-gray-900
                    ${cfg.border}
                    ${selected === cam.id ? "ring-2 ring-white/20" : ""}
                    ${state.risk === "Very High Risk" ? "animate-pulse" : ""}`}>

                  {/* Video area */}
                  <div className="relative aspect-video bg-gray-950">
                    <video
                      ref={el => videoRefs.current[cam.id] = el}
                      autoPlay muted
                      className="w-full h-full object-cover"
                    />

                    {/* TOP overlay: REC + camera name + risk badge + density */}
                    <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-b from-black/85 to-transparent">
                      <div className="flex items-center gap-1.5">
                        {state.active && (
                          <span className="text-xs bg-red-600 text-white px-1.5 py-0.5 rounded font-bold animate-pulse">
                            ● REC
                          </span>
                        )}
                        <span className="text-xs text-white font-bold drop-shadow">{cam.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                          {state.risk}
                        </span>
                        <span className="text-sm font-black text-white">
                          {state.density > 0 ? state.density : "--"}
                        </span>
                      </div>
                    </div>

                    {/* BOTTOM overlay: speed + chaos meter + rate */}
                    {state.active && state.density > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-t from-black/85 to-transparent">
                        {/* Speed */}
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">⚡</span>
                          <span className={`text-xs font-bold ${speedText(state.avg_speed || 0)}`}>
                            {(state.avg_speed || 0).toFixed(1)}px/f
                          </span>
                        </div>

                        {/* Chaos meter */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">🌀</span>
                          <div className="w-14 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, (state.chaos_score || 0) * 100)}%`,
                                backgroundColor: chaosColor(state.chaos_score || 0)
                              }}
                            />
                          </div>
                          <span className={`text-xs font-bold ${chaosText(state.chaos_score || 0)}`}>
                            {chaosLabel(state.chaos_score || 0)}
                          </span>
                        </div>

                        {/* Density rate */}
                        <span className={`text-xs font-bold ${(state.rate_of_change || 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {(state.rate_of_change || 0) > 0
                            ? `↑+${state.rate_of_change}`
                            : `↓${state.rate_of_change}`}/s
                        </span>
                      </div>
                    )}

                    {/* Placeholder when inactive */}
                    {!state.active && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700">
                        <span className="text-4xl mb-1">📷</span>
                        <span className="text-xs">{cam.name}</span>
                      </div>
                    )}
                  </div>

                  {/* Controls bar */}
                  <div
                    className="flex items-center justify-between px-3 py-2 bg-gray-900"
                    onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-gray-600">{cam.id}</span>
                    <div className="flex gap-1">
                      {!state.active ? (
                        <>
                          <label
                            className="cursor-pointer bg-blue-800 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded"
                            title="Load video file">
                            📁
                            <input
                              type="file" accept="video/*" className="hidden"
                              onChange={e => e.target.files[0] && startCamera(cam.id, e.target.files[0])}
                            />
                          </label>
                          <button
                            onClick={() => startCamera(cam.id, null)}
                            title="Use webcam"
                            className="bg-emerald-800 hover:bg-emerald-700 text-white text-xs px-2 py-1 rounded">
                            📷
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => stopCamera(cam.id)}
                          className="bg-red-800 hover:bg-red-700 text-white text-xs px-2 py-1 rounded">
                          ⏹ Stop
                        </button>
                      )}
                      <button
                        onClick={() => removeCamera(cam.id)}
                        title="Remove camera"
                        className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Add zone slot */}
            <div
              onClick={() => setShowModal(true)}
              className="rounded-xl border-2 border-dashed border-gray-800 hover:border-gray-600 cursor-pointer flex flex-col items-center justify-center text-gray-700 hover:text-gray-500 transition-all"
              style={{ aspectRatio: "16/9" }}>
              <span className="text-4xl mb-2">+</span>
              <span className="text-xs tracking-wider">Add Camera / Zone</span>
            </div>
          </div>
        </div>

        {/* ── Right Sidebar ────────────────────────────────────────── */}
        <div className="w-72 border-l border-gray-800 flex flex-col p-4 gap-5 overflow-y-auto flex-shrink-0">

          {/* Online volunteers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 tracking-widest uppercase">Online Volunteers</p>
              <span className="text-xs bg-emerald-900/60 text-emerald-400 px-2 py-0.5 rounded-full">
                {volunteers.length} live
              </span>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 min-h-12">
              {volunteers.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-2">No volunteers online</p>
              ) : volunteers.map((v, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-800 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"></span>
                  <span className="text-xs text-white font-bold truncate">{v}</span>
                  <span className="text-xs text-emerald-600 ml-auto">● live</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected camera motion stats */}
          <div>
            <p className="text-xs text-gray-500 tracking-widest uppercase mb-2">{selName} — Motion</p>
            <div className="bg-gray-900 rounded-xl p-3 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">⚡ Speed</span>
                <span className={`text-sm font-black ${speedText(selState.avg_speed)}`}>
                  {selState.avg_speed} px/f
                </span>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-gray-500">🌀 Chaos</span>
                  <span className={`text-xs font-bold ${chaosText(selState.chaos_score)}`}>
                    {chaosLabel(selState.chaos_score)} ({((selState.chaos_score || 0) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (selState.chaos_score || 0) * 100)}%`,
                      backgroundColor: chaosColor(selState.chaos_score || 0)
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">📈 Rate Δ</span>
                <span className={`text-sm font-black ${(selState.rate_of_change || 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {selState.rate_of_change > 0 ? `+${selState.rate_of_change}` : selState.rate_of_change}/s
                </span>
              </div>
            </div>
          </div>

          {/* Density trend chart */}
          <div>
            <p className="text-xs text-gray-500 tracking-widest uppercase mb-2">{selName} — Trend</p>
            <div className="bg-gray-900 rounded-xl p-3">
              {(history[selected] || []).length === 0 ? (
                <p className="text-gray-600 text-xs text-center py-6">No data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={history[selected] || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="time" hide />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} width={35} />
                    <Tooltip contentStyle={{ backgroundColor: "#111827", border: "none", fontSize: 10 }} />
                    <Line
                      type="monotone" dataKey="density"
                      stroke={CHART_COLOR[selState.risk] || "#10b981"}
                      strokeWidth={2} dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Critical alert log */}
          <div className="flex-1">
            <p className="text-xs text-gray-500 tracking-widest uppercase mb-2">🚨 Critical Log</p>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-4">No critical alerts yet</p>
              ) : logs.map((log, i) => (
                <div key={i} className="bg-red-950/60 border border-red-900 rounded-lg px-3 py-2">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-red-400">{log.camera_id}</span>
                    <span className="text-xs text-white font-mono">{log.density}</span>
                  </div>
                  {log.chaos_score !== undefined && (
                    <p className="text-xs text-gray-500">
                      chaos {((log.chaos_score || 0) * 100).toFixed(0)}% · speed {log.avg_speed}
                    </p>
                  )}
                  <p className="text-xs text-gray-600">{new Date(log.timestamp).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Volunteer Management Panel ───────────────────────────────── */}
      {showVolPanel && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-end"
          onClick={() => setShowVolPanel(false)}>
          <div
            className="bg-gray-900 border-l border-gray-700 h-full w-96 p-6 overflow-y-auto"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-black tracking-widest uppercase">👥 Volunteer Management</h2>
              <button onClick={() => setShowVolPanel(false)} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <div className="bg-emerald-950/40 border border-emerald-900 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-400">{volunteers.length}</p>
                <p className="text-xs text-gray-500">Online Now</p>
              </div>
              <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-blue-400">{allVolunteers.length}</p>
                <p className="text-xs text-gray-500">Registered</p>
              </div>
            </div>

            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">All Registered Volunteers</p>
            <div className="space-y-2">
              {allVolunteers.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">No volunteers registered yet</p>
              ) : allVolunteers.map(v => (
                <div key={v.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${volunteers.includes(v.username) ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`}></span>
                      <span className="text-sm font-bold text-white">{v.username}</span>
                      {volunteers.includes(v.username) && (
                        <span className="text-xs text-emerald-400">● online</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 ml-4">{v.email}</p>
                    <p className="text-xs text-gray-600 ml-4">
                      Joined {new Date(v.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleVolunteer(v.id)}
                    className={`text-xs px-2 py-1 rounded-lg border transition-all ${
                      v.is_active
                        ? "border-red-800 text-red-400 hover:bg-red-950"
                        : "border-emerald-800 text-emerald-400 hover:bg-emerald-950"
                    }`}>
                    {v.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Modal ────────────────────────────────────────────── */}
      {showProfile && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowProfile(false); setProfileMsg(null) }}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-black tracking-widest uppercase">⚙️ Profile Settings</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Logged in as <span className="text-white font-bold">{user?.username}</span>
                </p>
              </div>
              <button
                onClick={() => { setShowProfile(false); setProfileMsg(null) }}
                className="text-gray-500 hover:text-white text-lg">
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-gray-800 rounded-xl p-1 mb-5">
              <button
                onClick={() => { setProfileTab("password"); setProfileMsg(null) }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${profileTab === "password" ? "bg-blue-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                Change Password
              </button>
              <button
                onClick={() => { setProfileTab("username"); setProfileMsg(null) }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${profileTab === "username" ? "bg-blue-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                Change Username
              </button>
            </div>

            {/* Message */}
            {profileMsg && (
              <div className={`mb-4 px-4 py-3 rounded-xl text-xs border ${
                profileMsg.type === "success"
                  ? "bg-emerald-950 border-emerald-800 text-emerald-400"
                  : "bg-red-950 border-red-800 text-red-400"
              }`}>
                {profileMsg.text}
              </div>
            )}

            {/* Change Password Form */}
            {profileTab === "password" && (
              <form onSubmit={changePassword} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">
                    Current Password
                  </label>
                  <input
                    type="password" value={curPassword}
                    onChange={e => setCurPassword(e.target.value)} required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">
                    New Password
                  </label>
                  <input
                    type="password" value={newPassword}
                    onChange={e => setNewPassword(e.target.value)} required
                    placeholder="Min 6 characters"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold text-sm py-2.5 rounded-xl transition-all">
                  Update Password
                </button>
              </form>
            )}

            {/* Change Username Form */}
            {profileTab === "username" && (
              <form onSubmit={changeUsername} className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">
                    New Username
                  </label>
                  <input
                    type="text" value={newUsername}
                    onChange={e => setNewUsername(e.target.value)} required
                    placeholder="Choose a new username"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1">
                    Confirm with Password
                  </label>
                  <input
                    type="password" value={unPassword}
                    onChange={e => setUnPassword(e.target.value)} required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold text-sm py-2.5 rounded-xl transition-all">
                  Update Username
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Add Camera Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-80"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-black tracking-widest uppercase mb-1">Add Camera</h2>
            <p className="text-xs text-gray-500 mb-4">Enter the gate or area name for this camera</p>
            <input
              type="text" value={newCamName}
              onChange={e => setNewCamName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCamera()}
              placeholder="e.g. Main Gate, North Exit, VIP Zone"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={addCamera}
                className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-sm font-bold py-2.5 rounded-xl transition-all">
                Add Camera
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2.5 rounded-xl transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}