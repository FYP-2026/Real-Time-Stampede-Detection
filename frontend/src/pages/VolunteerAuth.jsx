import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authService } from "../services/auth"

export default function VolunteerAuth() {
  const [tab,      setTab]      = useState("login")
  const [username, setUsername] = useState("")
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [confirm,  setConfirm]  = useState("")
  const [error,    setError]    = useState("")
  const [loading,  setLoading]  = useState(false)
  const navigate = useNavigate()

  function resetForm() {
    setUsername(""); setEmail(""); setPassword(""); setConfirm(""); setError("")
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError(""); setLoading(true)
    try {
      const data = await authService.login(username, password)
      if (data.role !== "volunteer") {
        authService.clearSession()
        setError("This portal is for volunteers only. Use the Admin panel instead.")
        return
      }
      navigate("/volunteer")
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (password !== confirm) { setError("Passwords do not match"); return }
    if (password.length < 6)  { setError("Password must be at least 6 characters"); return }
    setError(""); setLoading(true)
    try {
      await authService.register(username, email, password)
      navigate("/volunteer")
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🛡️</div>
          <h1 className="text-2xl font-black tracking-widest">CROWDSAFE</h1>
          <p className="text-xs text-gray-500 mt-1 tracking-wider">Volunteer Portal</p>
        </div>

        <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1 mb-4">
          <button onClick={() => { setTab("login"); resetForm() }}
            className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${tab === "login" ? "bg-emerald-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
            SIGN IN
          </button>
          <button onClick={() => { setTab("register"); resetForm() }}
            className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${tab === "register" ? "bg-emerald-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
            REGISTER
          </button>
        </div>

        {tab === "login" && (
          <form onSubmit={handleLogin} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Your username" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            {error && <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-xs text-red-400">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-black text-sm py-3.5 rounded-xl tracking-widest transition-all">
              {loading ? "SIGNING IN..." : "SIGN IN"}
            </button>
          </form>
        )}

        {tab === "register" && (
          <form onSubmit={handleRegister} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Choose a username" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min 6 characters" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password" required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
            </div>
            {error && <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-xs text-red-400">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-black text-sm py-3.5 rounded-xl tracking-widest transition-all">
              {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
            </button>
          </form>
        )}

        <div className="text-center mt-5">
          <button onClick={() => navigate("/admin/login")} className="text-xs text-gray-600 hover:text-gray-400 underline">
            ← Admin Login
          </button>
        </div>
      </div>
    </div>
  )
}