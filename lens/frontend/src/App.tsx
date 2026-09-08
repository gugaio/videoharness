import { Link, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { Inspect } from './pages/Inspect'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="Stream Lens — página inicial">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          Stream&nbsp;Lens
        </Link>
        <span className="brand-sub">inspeção top-down de HLS · DASH</span>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/inspect/:inspectionId" element={<Inspect />} />
        </Routes>
      </main>
    </div>
  )
}
