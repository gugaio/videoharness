import { encodeCmcd } from "@svta/cml-cmcd";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(scriptDir, "../../internal/cmcd/testdata");
const checkOnly = process.argv.includes("--check");

const fixtures = [
  {
    file: "complete-v1.json",
    name: "complete v1 query",
    path: "/s/stream/master.m3u8",
    cmcd: {
      br: 3200,
      bl: 1200,
      bs: true,
      cid: "content-1",
      d: 4004,
      dl: 900,
      mtp: 25400,
      ot: "v",
      pr: 1.5,
      rtp: 15000,
      sf: "h",
      sid: "session-1",
      st: "v",
      su: true,
      tb: 6000,
    },
    want: {
      sid: "session-1",
      cid: "content-1",
      ot: "v",
      sf: "h",
      st: "v",
      br_kbps: 3200,
      tb_kbps: 6000,
      mtp_kbps: 25400,
      rtp_kbps: 15000,
      bl_ms: 1200,
      dl_ms: 900,
      object_duration_ms: 4004,
      playback_rate: 1.5,
      startup: true,
      buffer_starvation: true,
    },
  },
  {
    file: "implicit-booleans.json",
    name: "implicit booleans",
    path: "/s/stream/r/resource",
    cmcd: { bs: true, sid: "session-2", su: true },
    want: { sid: "session-2", startup: true, buffer_starvation: true },
  },
  {
    file: "quoted-escaped.json",
    name: "quoted and escaped strings",
    path: "/s/stream/master.m3u8",
    cmcd: {
      cid: 'a"b\\c',
      nor: "part,with,comma",
      nrr: "10-20",
      sid: "s\\id",
    },
    want: {
      sid: "s\\id",
      cid: 'a"b\\c',
      nor: "part,with,comma",
      nrr: "10-20",
    },
  },
];

let changed = false;
for (const fixture of fixtures) {
  const raw = encodeCmcd(fixture.cmcd, { version: 1 });
  const output = {
    name: fixture.name,
    url: `${fixture.path}?CMCD=${encodeURIComponent(raw)}`,
    want: {
      present: true,
      version: 1,
      raw_value: raw,
      canonical_value: raw,
      ...fixture.want,
    },
    issues: [],
  };
  const expected = `${JSON.stringify(output, null, 2)}\n`;
  const path = resolve(fixtureDir, fixture.file);
  const current = await readFile(path, "utf8").catch(() => "");
  if (current === expected) continue;
  changed = true;
  if (!checkOnly) await writeFile(path, expected);
}

if (checkOnly && changed) {
  throw new Error("CMCD fixtures are stale; run `npm run fixtures:cmcd`");
}
