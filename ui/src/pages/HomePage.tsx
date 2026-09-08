import { StartButton } from "../auth/AuthControls";

export default function HomePage() {
  return (
    <div className="home">
      <header className="home-header">
        <span className="brand">Video Harness</span>
      </header>
      <main className="hero">
        <h1>
          Investigue streams de vídeo
          <br />
          com evidência determinística.
        </h1>
        <p className="hero-sub">
          Inspeção de HLS/DASH, clones de teste e investigações guiadas por
          agentes — sobre as engines Stream Lens e Stream Mock.
        </p>
        <StartButton />
      </main>
      <footer className="home-footer">
        <span>Inspect · Streams · Investigations</span>
      </footer>
    </div>
  );
}
