import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { deleteRecording, listRecordings, type Recording } from "../lib/api";
import { formatBytes } from "../lib/format";

export function RecordingsPage(): JSX.Element {
  const navigate = useNavigate(); const client = useQueryClient(); const [confirming, setConfirming] = useState<string>();
  const recordings = useQuery({ queryKey: ["recordings"], queryFn: listRecordings, refetchInterval: 5_000 });
  const remove = useMutation({ mutationFn: deleteRecording, onSuccess: async () => { setConfirming(undefined); await client.invalidateQueries({ queryKey: ["recordings"] }); } });
  const items = recordings.data ?? [];
  const total = items.reduce((sum, recording) => sum + (recording.totalBytes ?? 0), 0);
  return <main className="min-h-screen bg-harness-bg px-5 pb-12 pt-6 text-harness-text sm:px-8 lg:px-12"><section className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between"><Link className="text-sm font-semibold text-white/85" to="/">Video Harness Space</Link><Link className="text-sm text-sky-200 hover:text-white" to="/record">Record VOD</Link></header>
    <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200/90 bg-[#f7f7fb] text-slate-700 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
      <div className="border-b border-slate-200 bg-white px-6 py-6 sm:px-8">
        <p className="text-xs font-medium uppercase tracking-[.25em] text-slate-400">Local storage</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">Recordings</h1>
        <p className="mt-3 text-sm text-slate-500">{items.length} recordings · {formatBytes(total)} registered. Delete removes published media and its temporary workspace.</p>
      </div>
      <div className="p-4 sm:p-5">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {recordings.isLoading ? <p className="p-8 text-center text-sm text-slate-400">Loading recordings…</p> : items.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">No recordings are using local storage.</p> : <div className="divide-y divide-slate-100">{items.map((recording) => <RecordingRow key={recording.id} recording={recording} confirming={confirming === recording.id} deleting={remove.isPending && confirming === recording.id} onOpen={() => navigate(`/recordings/${recording.id}`)} onDelete={() => setConfirming(confirming === recording.id ? undefined : recording.id)} onConfirm={() => remove.mutate(recording.id)} />)}</div>}
        </div>
      </div>
    </div>
    {remove.error && <p className="mt-4 text-sm text-rose-600">{remove.error.message}</p>}
  </section></main>;
}

function RecordingRow({ recording, confirming, deleting, onOpen, onDelete, onConfirm }: { recording: Recording; confirming: boolean; deleting: boolean; onOpen: () => void; onDelete: () => void; onConfirm: () => void }): JSX.Element {
  return <article className="flex flex-wrap items-center gap-4 p-5"><button className="min-w-0 flex-1 text-left" onClick={onOpen}><p className="truncate font-mono text-xs text-slate-800">{recording.sourceUrl}</p><p className="mt-2 text-xs text-slate-400">{recording.protocol.toUpperCase()} · {recording.state} · {recording.totalBytes === undefined ? "size pending" : formatBytes(recording.totalBytes)} · {new Date(recording.createdAt).toLocaleString()}</p></button><div className="flex shrink-0 gap-2"><button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300" onClick={onOpen}>Open</button>{confirming ? <button className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={deleting} onClick={onConfirm}>{deleting ? "Deleting…" : "Confirm delete"}</button> : <button className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-600 hover:border-rose-300" onClick={onDelete}>Delete files</button>}</div></article>;
}
