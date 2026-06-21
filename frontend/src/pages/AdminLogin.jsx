import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authService } from "../services/auth"

export default function AdminLogin() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState("")
  const [loading,  setLoading]  = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const data = await authService.login(username, password)
      if (data.role !== "admin") {
        authService.clearSession()
        setError("This login is for admins only. Use the Volunteer portal instead.")
        return
      }
      navigate("/dashboard")
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono flex items-center justify-center p-5">
      <div className="w-full max-w-sm">

        <div className="text-center mb-10">
          <div className="text-6xl mb-4">🛡️</div>
          <h1 className="text-3xl font-black tracking-widest uppercase">CrowdSafe</h1>
          <p className="text-xs text-gray-500 mt-2 tracking-widest">Admin Control Panel</p>
        </div>

        <form onSubmit={handleLogin} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Enter username" required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest block mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-xs text-red-400">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-black text-sm py-3.5 rounded-xl tracking-widest transition-all">
            {loading ? "SIGNING IN..." : "SIGN IN AS ADMIN"}
          </button>
        </form>

        <div className="text-center mt-6">
          <p className="text-xs text-gray-600">Are you a volunteer?</p>
          <button onClick={() => navigate("/volunteer/login")}
            className="text-xs text-emerald-400 hover:text-emerald-300 mt-1 underline">
            Go to Volunteer Portal →
          </button>
        </div>

      </div>
    </div>
  )
}