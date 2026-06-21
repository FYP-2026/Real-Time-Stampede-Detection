const TOKEN_KEY = "crowdsafe_token"
const USER_KEY  = "crowdsafe_user"

export const authService = {
  // Save login data
  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },

  // Clear session
  clearSession() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },

  // Get token
  getToken() {
    return localStorage.getItem(TOKEN_KEY)
  },

  // Get logged-in user
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY))
    } catch {
      return null
    }
  },

  // Check if logged in
  isLoggedIn() {
    return !!this.getToken()
  },

  // Check if admin
  isAdmin() {
    return this.getUser()?.role === "admin"
  },

  // Check if volunteer
  isVolunteer() {
    return this.getUser()?.role === "volunteer"
  },

  // Auth header for API calls
  headers() {
    return {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${this.getToken()}`
    }
  },

  // Login API call
  async login(username, password) {
    const form = new URLSearchParams()
    form.append("username", username)
    form.append("password", password)

    const res = await fetch("http://localhost:8000/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    form
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || "Login failed")
    this.setSession(data.access_token, { username: data.username, role: data.role })
    return data
  },

  // Register API call (volunteer)
  async register(username, email, password) {
    const res = await fetch("http://localhost:8000/api/auth/register", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, email, password })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || "Registration failed")
    this.setSession(data.access_token, { username: data.username, role: data.role })
    return data
  },

  // Get WebSocket URL with token
  wsUrl(path) {
    return `ws://localhost:8000${path}?token=${this.getToken()}`
  }
}