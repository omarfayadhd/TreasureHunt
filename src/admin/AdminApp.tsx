import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import AdminLogin from './AdminLogin'
import Dashboard from './Dashboard'
import TeamsPanel from './TeamsPanel'
import StationsPanel from './StationsPanel'
import GameControl from './GameControl'
import PrintPage from './PrintPage'

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (checking) return null
  if (!session) return <AdminLogin />

  return (
    <div className="admin">
      <nav className="admin-nav">
        <span className="admin-brand">🗺️ Hunt Admin</span>
        <NavLink to="/admin" end>Dashboard</NavLink>
        <NavLink to="/admin/teams">Teams</NavLink>
        <NavLink to="/admin/stations">Stations</NavLink>
        <NavLink to="/admin/control">Game control</NavLink>
        <NavLink to="/admin/print">Print</NavLink>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
      <main className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="teams" element={<TeamsPanel />} />
          <Route path="stations" element={<StationsPanel />} />
          <Route path="control" element={<GameControl />} />
          <Route path="print" element={<PrintPage />} />
        </Routes>
      </main>
    </div>
  )
}
