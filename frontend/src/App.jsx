import { HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { authService } from "./services/auth"
import AdminLogin     from "./pages/AdminLogin"
import VolunteerAuth  from "./pages/VolunteerAuth"
import Dashboard      from "./pages/Dashboard"
import VolunteerAlert from "./pages/VolunteerAlert"

function AdminRoute({ children }) {
  if (!authService.isLoggedIn() || !authService.isAdmin())
    return <Navigate to="/" replace />
  return children
}

function VolunteerRoute({ children }) {
  if (!authService.isLoggedIn() || !authService.isVolunteer())
    return <Navigate to="/volunteer/login" replace />
  return children
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/"                element={<AdminLogin />} />
        <Route path="/volunteer/login" element={<VolunteerAuth />} />
        <Route path="/dashboard"       element={<AdminRoute><Dashboard /></AdminRoute>} />
        <Route path="/volunteer"       element={<VolunteerRoute><VolunteerAlert /></VolunteerRoute>} />
        <Route path="*"                element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}