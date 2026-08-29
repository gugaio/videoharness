import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Show, SignInButton, UserButton } from "@clerk/react";
import { addStream } from "../api";
import backgroundImage from "../assets/Background.jpeg";

export default function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  async function handleClone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCloning(true);
    try {
      const stream = await addStream(url.trim());
      navigate(`/stream/${stream.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCloning(false);
    }
  }

  return (
    <main
      className="relative isolate flex min-h-screen flex-col overflow-hidden bg-cover bg-center bg-no-repeat text-white"
      style={{ backgroundImage: `url(${backgroundImage})` }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-8 sm:px-10 lg:px-24">
        <Link to="/" className="text-xl font-medium tracking-[-0.04em] text-white sm:text-2xl">
          Stream Mock
        </Link>

        <div className="flex items-center gap-3 sm:gap-7">
          <Link
            to="/about"
            className="hidden rounded-full border border-white/25 px-7 py-3 text-base font-medium text-white/90 transition hover:bg-white/10 sm:inline-flex"
          >
            About
          </Link>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="rounded-full bg-white px-7 py-3 text-base font-semibold text-zinc-900 shadow-sm transition hover:bg-white/90">
                Login
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link
              to="/workspace"
              className="hidden rounded-full border border-white/25 px-7 py-3 text-base font-medium text-white/90 transition hover:bg-white/10 sm:inline-flex"
            >
              Workspace
            </Link>
          </Show>
          <div className="flex items-center self-center">
            <UserButton />
          </div>
        </div>
      </header>

      <section id="about" className="relative z-10 flex flex-1 flex-col items-center justify-end px-6 pb-10 pt-24 text-center sm:px-10 sm:pb-16 lg:px-24 lg:pb-24">
        <div className="flex w-full max-w-5xl flex-col items-center drop-shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
          <h1 className="max-w-4xl text-4xl leading-[1.02] font-extrabold tracking-[-0.04em] sm:text-5xl md:text-6xl lg:text-7xl">
            Clone &amp; Test Video<br className="hidden md:block" /> Streams in Seconds
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-[1.35] text-white/90 sm:text-lg md:text-2xl">
            The all-in-one HLS and DASH player simulator. Empowers Devs, QA, and
            teams to test playback behavior under any condition.
          </p>
        </div>

        <form
          onSubmit={handleClone}
          className="mt-12 flex w-full max-w-3xl flex-col gap-3 rounded-[2rem] border border-white/25 bg-zinc-950/65 p-3 shadow-[0_12px_35px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:flex-row sm:items-center sm:rounded-full sm:pl-7"
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="Paste your streaming URL here ..."
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-base text-white placeholder:text-white/60 focus:outline-none sm:px-0"
          />
          <button
            type="submit"
            disabled={cloning}
            className="rounded-full bg-white px-8 py-4 text-base font-semibold text-zinc-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cloning ? "Cloning…" : "Clone & Test"}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        <Link
          to="/stream/big-buck-bunny"
          className="mt-5 inline-block text-sm text-white/70 transition hover:text-white"
        >
          Try the Big Buck Bunny demo →
        </Link>
      </section>
    </main>
  );
}
