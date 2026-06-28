import { HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { authService } from "./services/auth"
import AdminLogin     from "./pages/AdminLogin"
import VolunteerAuth  from "./pages/VolunteerAuth"
import Dashboard      from "./pages/Dashboard"
import VolunteerAlert from "./pages/VolunteerAlert"

function AdminRoute({ children }) {
  if (!authService.isLoggedIn() || !authService.isAdmin())
    return <Navigate to="/admin/login" replace />
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
        {/* Admin routes */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin"       element={<AdminRoute><Dashboard /></AdminRoute>} />

        {/* Volunteer routes */}
        <Route path="/volunteer/login" element={<VolunteerAuth />} />
        <Route path="/volunteer"       element={<VolunteerRoute><VolunteerAlert /></VolunteerRoute>} />

        {/* Root redirect */}
        <Route path="/" element={
          authService.isAdmin()     ? <Navigate to="/admin"     replace /> :
          authService.isVolunteer() ? <Navigate to="/volunteer" replace /> :
                                      <Navigate to="/admin/login" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}