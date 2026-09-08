import { setPreset } from "../api";
import type { Preset, Stream } from "../types";

interface Props {
  stream: Stream;
  onPresetChange: (stream: Stream) => void;
  token?: string;
}

export default function PresetSelect({ stream, onPresetChange, token }: Props) {
  return (
    <select
      value={stream.active_preset}
      onChange={(e) => {
        setPreset(stream.id, e.target.value, token)
          .then(onPresetChange)
          .catch((err: Error) => window.alert(err.message));
      }}
      className="cursor-pointer rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-sm text-stone-100 outline-none transition hover:bg-white/[0.12] focus:border-amber-100/60"
    >
      {stream.presets.map((p: Preset) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
