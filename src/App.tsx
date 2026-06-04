import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import CreateParty from './pages/creator/CreateParty'
import Dashboard from './pages/creator/Dashboard'
import CastScreen from './pages/creator/CastScreen'
import PlayerPage from './pages/creator/PlayerPage'
import DoorScanner from './pages/door/DoorScanner'
import Landing from './pages/attendee/Landing'
import PassPage from './pages/attendee/PassPage'
import SwipeWindow from './pages/attendee/SwipeWindow'
import Lobby from './pages/attendee/Lobby'
import ClosedState from './pages/attendee/ClosedState'
import NowPlaying from './pages/attendee/NowPlaying'
import Leaderboard from './pages/attendee/Leaderboard'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateParty />} />
      <Route path="/creator/:partyId" element={<Dashboard />} />
      <Route path="/party/:partyId/cast" element={<CastScreen />} />
      <Route path="/player/:partyId" element={<PlayerPage />} />
      <Route path="/door/:partyId" element={<DoorScanner />} />
      <Route path="/party/:partyId" element={<Landing />} />
      <Route path="/party/:partyId/pass" element={<PassPage />} />
      <Route path="/party/:partyId/swipe" element={<SwipeWindow />} />
      <Route path="/party/:partyId/lobby" element={<Lobby />} />
      <Route path="/party/:partyId/closed" element={<ClosedState />} />
      <Route path="/party/:partyId/now" element={<NowPlaying />} />
      <Route path="/party/:partyId/leaderboard" element={<Leaderboard />} />
    </Routes>
  )
}
