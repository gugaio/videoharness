import type { ReactNode } from "react";

export type AgentHue = "sky" | "violet" | "fuchsia" | "emerald" | "amber" | "rose" | "slate";

export interface AgentPersona {
  /** Display name of the persona, e.g. "Nova". */
  name: string;
  /** Short human role, e.g. "Network & Security". */
  role: string;
  hue: AgentHue;
  icon: JSX.Element;
}

interface HueStyle {
  avatar: string;
  softChip: string;
  text: string;
  dot: string;
  ring: string;
}

const HUE_STYLES: Record<AgentHue, HueStyle> = {
  sky: {
    avatar: "from-sky-400/90 to-blue-500/90 shadow-sky-500/25",
    softChip: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    text: "text-sky-300",
    dot: "bg-sky-400",
    ring: "ring-sky-300/40",
  },
  violet: {
    avatar: "from-violet-400/90 to-purple-500/90 shadow-violet-500/25",
    softChip: "border-violet-300/25 bg-violet-300/10 text-violet-200",
    text: "text-violet-300",
    dot: "bg-violet-400",
    ring: "ring-violet-300/40",
  },
  fuchsia: {
    avatar: "from-fuchsia-400/90 to-pink-500/90 shadow-fuchsia-500/25",
    softChip: "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-200",
    text: "text-fuchsia-300",
    dot: "bg-fuchsia-400",
    ring: "ring-fuchsia-300/40",
  },
  emerald: {
    avatar: "from-emerald-400/90 to-teal-500/90 shadow-emerald-500/25",
    softChip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    ring: "ring-emerald-300/40",
  },
  amber: {
    avatar: "from-amber-400/90 to-orange-500/90 shadow-amber-500/25",
    softChip: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    text: "text-amber-300",
    dot: "bg-amber-400",
    ring: "ring-amber-300/40",
  },
  rose: {
    avatar: "from-rose-400/90 to-red-500/90 shadow-rose-500/25",
    softChip: "border-rose-300/25 bg-rose-300/10 text-rose-200",
    text: "text-rose-300",
    dot: "bg-rose-400",
    ring: "ring-rose-300/40",
  },
  slate: {
    avatar: "from-slate-400/90 to-slate-500/90 shadow-slate-500/25",
    softChip: "border-white/15 bg-white/[0.07] text-white/70",
    text: "text-white/60",
    dot: "bg-slate-400",
    ring: "ring-white/25",
  },
};

export function hueStyle(hue: AgentHue): HueStyle {
  return HUE_STYLES[hue];
}

/* ---------- Icons (stroke style, inherit currentColor) ---------- */

function Icon(props: { children: ReactNode }): JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      {props.children}
    </svg>
  );
}

function ShieldIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V5.8L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m9.3 11.6 2 2 3.6-3.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

function FilmIcon(): JSX.Element {
  return (
    <Icon>
      <rect height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="4.5" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </Icon>
  );
}

function GaugeIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4.5 15.5a8 8 0 1 1 15 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M12 15.5 15.5 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
    </Icon>
  );
}

function SparklesIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 4l1.7 4.6L18.5 10l-4.8 1.4L12 16l-1.7-4.6L5.5 10l4.8-1.4L12 4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="currentColor" />
    </Icon>
  );
}

function CompassIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </Icon>
  );
}

function BoltIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12L13 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

function BoxIcon(): JSX.Element {
  return (
    <Icon>
      <path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M4 7.2 12 11.4l8-4.2M12 11.4V21" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </Icon>
  );
}

function GlobeIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  );
}

function FlagIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6 21V4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M6 4.5h11.5l-2.8 3.7 2.8 3.8H6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

/* ---------- Personas ---------- */

const ACTOR_PERSONAS: Record<string, AgentPersona> = {
  system: { name: "VHS", role: "Case desk", hue: "slate", icon: <BoltIcon /> },
  "Network Agent": { name: "Nova", role: "Network & Security", hue: "sky", icon: <ShieldIcon /> },
  "Media Agent": { name: "Milo", role: "Media Evidence", hue: "amber", icon: <FilmIcon /> },
  "Playback Agent": { name: "Pip", role: "Playback & Timeline", hue: "emerald", icon: <GaugeIcon /> },
  "AI Investigation Team": { name: "Aia", role: "AI Synthesis Team", hue: "fuchsia", icon: <SparklesIcon /> },
  Investigator: { name: "Lead", role: "Lead Investigator", hue: "violet", icon: <CompassIcon /> },
};

const SPECIALIST_PERSONAS: Record<string, AgentPersona> = {
  "timeline-playback": { name: "Pip", role: "Timeline & Playback", hue: "emerald", icon: <GaugeIcon /> },
  "container-encoding": { name: "Coda", role: "Container & Encoding", hue: "amber", icon: <BoxIcon /> },
  "manifest-delivery": { name: "Mara", role: "Manifest & Delivery", hue: "sky", icon: <GlobeIcon /> },
  "lead-investigator": { name: "Lead", role: "Lead Investigator", hue: "violet", icon: <CompassIcon /> },
};

const FALLBACK_PERSONA: AgentPersona = { name: "Agent", role: "Investigation team", hue: "slate", icon: <BoltIcon /> };

export function personaForActor(actor: string): AgentPersona {
  return ACTOR_PERSONAS[actor] ?? SPECIALIST_PERSONAS[actor] ?? { ...FALLBACK_PERSONA, name: actor };
}

export function personaForSpecialist(id: string): AgentPersona {
  return SPECIALIST_PERSONAS[id] ?? { ...FALLBACK_PERSONA, name: id };
}

/* ---------- Avatar ---------- */

export function AgentAvatar(props: {
  persona: AgentPersona;
  size?: "sm" | "md" | "lg";
  active?: boolean;
}): JSX.Element {
  const size = props.size ?? "md";
  const classes =
    size === "sm"
      ? "h-7 w-7 rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5"
      : size === "lg"
        ? "h-12 w-12 rounded-2xl [&>svg]:h-6 [&>svg]:w-6"
        : "h-10 w-10 rounded-xl [&>svg]:h-5 [&>svg]:w-5";
  const hue = hueStyle(props.persona.hue);
  return (
    <span
      className={`relative grid shrink-0 place-items-center bg-gradient-to-br text-white shadow-lg ${hue.avatar} ${classes} ${
        props.active ? `ring-2 ring-offset-2 ring-offset-harness-bg ${hue.ring}` : ""
      }`}
      title={`${props.persona.name} · ${props.persona.role}`}
    >
      {props.persona.icon}
      {props.active && (
        <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-harness-bg ${hue.dot} animate-pulse-dot`} />
      )}
    </span>
  );
}

/* ---------- Severity & confidence semantics ---------- */

export type Severity = "info" | "warning" | "error";

export const SEVERITY_STYLES: Record<Severity, { chip: string; dot: string; label: string }> = {
  info: { chip: "border-sky-300/25 bg-sky-300/10 text-sky-200", dot: "bg-sky-400", label: "Observed" },
  warning: { chip: "border-amber-300/25 bg-amber-300/10 text-amber-200", dot: "bg-amber-400", label: "Needs attention" },
  error: { chip: "border-rose-300/25 bg-rose-300/10 text-rose-200", dot: "bg-rose-400", label: "Critical" },
};

export interface ConfidenceTone {
  label: string;
  stroke: string;
  text: string;
}

export function confidenceTone(value: number): ConfidenceTone {
  if (value >= 0.85) return { label: "High confidence", stroke: "#34d399", text: "text-emerald-300" };
  if (value >= 0.65) return { label: "Moderate confidence", stroke: "#fbbf24", text: "text-amber-200" };
  if (value >= 0.4) return { label: "Limited confidence", stroke: "#fb923c", text: "text-orange-200" };
  return { label: "Low confidence", stroke: "#fb7185", text: "text-rose-300" };
}

export function FlagMarker(): JSX.Element {
  return <FlagIcon />;
}
