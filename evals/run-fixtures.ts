import { evalCases } from "./cases/index.js";
import { runFixtureCase } from "./core/fixture-runner.js";

const argumentsList = process.argv.slice(2);
const keep = argumentsList.includes("--keep");
const selectedId = readOption(argumentsList, "--case");
const selectedCases = selectedId ? evalCases.filter((evalCase) => evalCase.id === selectedId) : evalCases;

if (selectedCases.length === 0) {
  throw new Error(`Unknown eval case: ${selectedId}`);
}

for (const evalCase of selectedCases) {
  const result = await runFixtureCase(evalCase, keep);
  const intervals = result.intervals.length === 0 ? "no intervals" : result.intervals
    .map((interval) => `${interval.startSeconds.toFixed(3)}s-${interval.endSeconds.toFixed(3)}s`)
    .join(", ");
  console.log(`PASS ${result.id}: ${result.detector} ${intervals}${result.retained ? ` (${result.directory})` : ""}`);
}

function readOption(values: string[], option: string): string | undefined {
  const index = values.indexOf(option);
  if (index === -1) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}
