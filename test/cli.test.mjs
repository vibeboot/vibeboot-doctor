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

test("placeholder AUTH_SECRET from a template is a WARN, value masked", () => {
  for (const v of ["replace-with-a-long-random-string", "changeme", "your-secret-here", "paste-the-output-of-npx-auth-secret"]) {
    const dir = project({ "package.json": PKG, ".gitignore": ".env*\n", ".env": `AUTH_SECRET="${v}"\n` });
    const r = run([dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WARN\s+\.env:1 AUTH_SECRET/, v);
    assert.match(r.stdout, /Placeholder auth secret/, v);
    assert.match(r.stdout, /openssl rand -base64 32/, v);
  }
});

test("a real random AUTH_SECRET is not flagged", () => {
  const dir = project({ "package.json": PKG, ".gitignore": ".env*\n", ".env": 'AUTH_SECRET="k3Jq9vB7wZ2mN8pL4tR6yU1oI5aS0dFgH7jK2lQ9xC4="\n' });
  const r = run([dir]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /AUTH_SECRET/);
});

test("MissingSecret advice never tells people to run npx auth secret", () => {
  const r = run(["[auth][error] MissingSecret: Please define a `secret`"]);
  assert.match(r.stdout, /openssl rand -base64 32/);
  assert.doesNotMatch(r.stdout, /Generate one: npx auth secret/);
  assert.doesNotMatch(r.stdout, /paste-the-output-of-npx-auth-secret/);
});

test(".env not covered by .gitignore is a WARN (asks git; .env*.local only covers .local files)", () => {
  const env = { "package.json": PKG, ".env": "DATABASE_URL=file:./dev.db\n" };
  const cases = [
    { gi: ".env*.local\n", git: true, warn: true },
    { gi: ".env*.local\n", git: false, warn: true },
    { gi: ".env*\n!.env\n", git: true, warn: true },
    { gi: ".env*\n!.env\n", git: false, warn: true },
    { gi: ".env*\n!.env.example\n", git: true, warn: false },
    { gi: "/.env\n", git: false, warn: false },
    { gi: "**/.env\n", git: false, warn: false },
    { gi: ".env\n", git: true, warn: false },
  ];
  for (const { gi, git, warn } of cases) {
    const dir = project({ ...env, ".gitignore": gi });
    if (git) execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    const r = run([dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const label = `${JSON.stringify(gi)} git=${git}`;
    if (warn) assert.match(r.stdout, /WARN\s+\.gitignore doesn't cover \.env/, label);
    else assert.doesNotMatch(r.stdout, /gitignore doesn't cover/, label);
  }
});

test("a Google redirect_uri_mismatch error matches the Google fix, not the GitHub one", () => {
  const r = run(["Access blocked: This app's request is invalid. Error 400: redirect_uri_mismatch"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /1\. Google: Error 400 redirect_uri_mismatch/);
  assert.match(r.stdout, /fix\/authjs\/google-redirect-uri/);
});

function nested(files, { git = false, add = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vbd-"));
  for (const [n, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), c); }
  if (git) {
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    g("init", "-q"); g("add", "-A"); for (const f of add) g("add", "-f", f);
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  }
  return dir;
}
const LOCAL = { ".claude/settings.local.json": '{"permissions":{"allow":["Bash(npm test)"]}}\n', "CLAUDE.local.md": "my notes\n" };

test("personal Claude Code files that git would commit are a WARN (git repo and no-git fallback)", () => {
  for (const git of [true, false]) {
    const dir = nested({ "package.json": PKG, ".gitignore": "node_modules\n", ...LOCAL });
    if (git) execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    const r = run([dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WARN\s+\.gitignore doesn't cover \.claude\/settings\.local\.json, CLAUDE\.local\.md/, `git=${git}`);
  }
});

test("personal Claude Code files covered by .gitignore are not flagged (exact paths, a .claude/ folder rule, a name rule)", () => {
  for (const gi of [".claude/settings.local.json\nCLAUDE.local.md\n", ".claude/\n*.local.md\n", "settings.local.json\n/CLAUDE.local.md\n"]) {
    for (const git of [true, false]) {
      const dir = nested({ "package.json": PKG, ".gitignore": gi, ...LOCAL });
      if (git) execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
      const r = run([dir]);
      assert.doesNotMatch(r.stdout, /Claude Code file/, `${JSON.stringify(gi)} git=${git}`);
    }
  }
});

test("a committed personal Claude Code file is a WARN with the git rm --cached fix, not a LEAK", () => {
  const dir = nested({ "package.json": PKG, ".gitignore": "", ".claude/settings.local.json": LOCAL[".claude/settings.local.json"] }, { git: true });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WARN\s+Personal Claude Code file committed: \.claude\/settings\.local\.json/);
  assert.match(r.stdout, /git rm --cached \.claude\/settings\.local\.json/);
  assert.doesNotMatch(r.stdout, /LEAK/);
});
