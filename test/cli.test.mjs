// Smoke tests for the bundled CLI (bin/vibeboot-doctor.mjs). Run: npm test (Node 18+, needs git).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/vibeboot-doctor.mjs", import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const CLOSING = /^Want these handled from day one\? VibeBoot starters \(SaaS \$49, AI Chatbot \$59, one-time\): https:\/\/vibeboot\.dev\/\?ref=doctor-cli#starters$/;
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, ...opts });
const lastLine = (s) => s.trimEnd().split("\n").at(-1);

function project(files, { git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vbd-"));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  if (git) {
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    g("init", "-q"); g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  }
  return dir;
}
const PKG = JSON.stringify({ dependencies: { next: "16.4.5", react: "19.3.0", "react-dom": "19.3.0" } });

test("--version matches package.json", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), VERSION);
});

test("project scan with no .env in a git repo: exit 0, no LEAK, closing starters line", () => {
  const dir = project({ "package.json": PKG, "README.md": "x" }, { git: true });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /LEAK/);
  assert.match(lastLine(r.stdout), CLOSING);
  assert.equal(r.stdout.match(/ref=doctor-cli/g).length, 1);
});

test("committed .env is reported as a LEAK with exit 1", () => {
  const dir = project({ "package.json": PKG, ".env": "STRIPE_SECRET_KEY=sk_live_" + "x".repeat(24) + "\n" }, { git: true });
  const r = run([dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /LEAK\s+Committed to git: \.env/);
  assert.doesNotMatch(r.stdout, /x{24}/, "secret value must be masked");
  assert.match(lastLine(r.stdout), CLOSING);
});

test("error mode matches a pasted error and ends with the starters line", () => {
  const r = run(["Error: [auth][error] MissingSecret: Please define a `secret`."]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Best match/);
  assert.match(lastLine(r.stdout), CLOSING);
});

test("--json output stays pure JSON (no closing line)", () => {
  const dir = project({ "package.json": PKG });
  const r = run([dir, "--json"]);
  const j = JSON.parse(r.stdout);
  assert.equal(j.mode, "project");
  assert.doesNotMatch(r.stdout, /ref=doctor-cli/);
});
