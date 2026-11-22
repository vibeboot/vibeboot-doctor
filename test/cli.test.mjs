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

test("error mode knows all 76 fixes, incl. Dynamic server usage and NEXT_PUBLIC_ undefined", () => {
  assert.match(run(["--help"]).stdout, /against 76 known fixes/);
  const d = run(["Error: Dynamic server usage: Route /account couldn't be rendered statically because it used `cookies`."]);
  assert.equal(d.status, 0, d.stdout);
  assert.match(d.stdout, /fix\/nextjs\/dynamic-server-usage/);
  const e = run(["process.env.NEXT_PUBLIC_API_URL is undefined in production"]);
  assert.equal(e.status, 0, e.stdout);
  assert.match(e.stdout, /fix\/nextjs\/next-public-env-undefined/);
});

const W = '"use client";\nimport { useEffect } from "react";\n';
test("NEXT_PUBLIC_ destructured from process.env in a \"use client\" file is a WARN with file:line", () => {
  const dir = nested({
    "package.json": PKG,
    "src/app/widget.tsx": W + "// a comment\nconst { NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_NAME: name } = process.env;\nexport default function W() { return null; }\n",
    "node_modules/x/index.js": '"use client";\nconst { NEXT_PUBLIC_X } = process.env;\n',
  });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WARN\s+NEXT_PUBLIC_ destructured from process\.env in a client file: src\/app\/widget\.tsx:4 \(NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_NAME\)/);
  assert.match(r.stdout, /fix\/nextjs\/next-public-env-undefined/);
  assert.doesNotMatch(r.stdout, /node_modules/);
});

test("NEXT_PUBLIC_ written out in full is not flagged; destructuring in server code is only a note", () => {
  const ok = nested({ "package.json": PKG, "src/app/w.tsx": W + "const url = process.env.NEXT_PUBLIC_API_URL;\nconst { NODE_ENV } = process.env;\n// const { NEXT_PUBLIC_OLD } = process.env;\n/* const { NEXT_PUBLIC_B } = process.env; */\n" });
  const a = run([ok]);
  assert.doesNotMatch(a.stdout, /destructured/, a.stdout);
  const srv = nested({ "package.json": PKG, "src/lib/config.ts": "export const { NEXT_PUBLIC_SITE_URL } = process.env;\n" });
  const b = run([srv, "--json"]);
  const f = JSON.parse(b.stdout).findings.filter((x) => /destructured/.test(x.title));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "info");
  assert.equal(f[0].file, "src/lib/config.ts");
});

test("a plain Vercel timeout matches the AI SDK maxDuration fix first, not the Stripe webhook one", () => {
  const r = run(["Vercel Runtime Timeout Error: Task timed out after 30 seconds"]);
  assert.equal(r.status, 0, r.stdout);
  const first = r.stdout.split("\n").find((l) => /^1\. /.test(l));
  assert.match(first, /AI SDK stream stops or times out on Vercel/);
  assert.match(r.stdout, /fix\/nextjs\/ai-sdk-stream-timeout/);
  const s = run(["Stripe webhook: Task timed out after 10 seconds"]);
  assert.match(s.stdout.split("\n").find((l) => /^1\. /.test(l)), /Timed out \/ not returning 2xx fast/);
});

const AI_ROUTE = 'import { streamText } from "ai";\nimport { openai } from "@ai-sdk/openai";\n\n';
test("short maxDuration and Edge runtime on an AI streaming route are notes with file:line", () => {
  const dir = nested({
    "package.json": PKG,
    "src/app/api/chat/route.ts": AI_ROUTE + "export const maxDuration = 30;\nexport const runtime = \"edge\";\nexport async function POST(req: Request) { return streamText({ model: openai(\"x\"), prompt: \"hi\" }).toUIMessageStreamResponse(); }\n",
  });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /INFO\s+Short maxDuration on an AI streaming route: src\/app\/api\/chat\/route\.ts:4 \(30s\)/);
  assert.match(r.stdout, /INFO\s+Edge runtime on an AI streaming route: src\/app\/api\/chat\/route\.ts:5/);
  assert.match(r.stdout, /fix\/nextjs\/ai-sdk-stream-timeout/);
  assert.doesNotMatch(r.stdout, /WARN/);
});

test("no AI note for a long maxDuration, a non AI route, commented out lines or files outside app/", () => {
  const dir = nested({
    "package.json": PKG,
    "app/api/chat/route.ts": AI_ROUTE + "export const maxDuration = 300;\n// export const runtime = \"edge\";\n/* export const maxDuration = 10; */\nexport async function POST() { return streamText({}).toTextStreamResponse(); }\n",
    "app/api/cron/route.ts": "export const maxDuration = 10;\nexport const runtime = \"edge\";\nexport async function GET() { return new Response(\"ok\"); }\n",
    "src/lib/ai.ts": AI_ROUTE + "export const maxDuration = 10;\n",
  });
  const r = run([dir, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).findings.filter((f) => /AI streaming route/.test(f.title)), []);
});

test("NEXT_PUBLIC_ destructuring quoted inside a string (docs, fix text) is not flagged", () => {
  const dir = nested({
    "package.json": PKG,
    "src/lib/fixes.ts": 'export const tip = "Don\'t destructure it: const { NEXT_PUBLIC_API_URL } = process.env is undefined in the browser";\nexport const t2 = `const { NEXT_PUBLIC_B } = process.env`;\n',
    "src/app/c.tsx": W + 'const url = "a//b"; const { NEXT_PUBLIC_REAL } = process.env;\n',
  });
  const r = run([dir, "--json"]);
  const f = JSON.parse(r.stdout).findings.filter((x) => /destructured/.test(x.title));
  assert.equal(f.length, 1, r.stdout);
  assert.match(f[0].title, /src\/app\/c\.tsx:3 \(NEXT_PUBLIC_REAL\)/);
  assert.doesNotMatch(r.stdout, /fixes\.ts|NEXT_PUBLIC_B/);
});

test("an OpenAI 429 quota or rate limit error matches the openai-429-quota fix first", () => {
  for (const text of [
    "429 You exceeded your current quota, please check your plan and billing details. insufficient_quota",
    "AI_RetryError: Failed after 3 attempts. Last error: You exceeded your current quota",
    "Rate limit reached for gpt-4o-mini in organization org-abc on tokens per min (TPM): Limit 200000, Used 199500, Requested 1200.",
  ]) {
    const r = run([text]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout.split("\n").find((l) => /^1\. /.test(l)), /OpenAI 429 in a chat app/, text);
    assert.match(r.stdout, /fix\/nextjs\/openai-429-quota/);
  }
});

test("a for await loop over streamText's textStream is a note (provider errors never reach the catch)", () => {
  const dir = nested({
    "package.json": PKG,
    "src/lib/ai/provider.ts": AI_ROUTE + "export async function* chat() {\n  const result = streamText({ model: openai(\"x\"), prompt: \"hi\" });\n  try {\n    for await (const chunk of result.textStream) yield chunk;\n  } catch (e) { console.error(e); }\n}\n",
  });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /INFO\s+AI SDK textStream hides provider errors: src\/lib\/ai\/provider\.ts:7/);
  assert.match(r.stdout, /fix\/nextjs\/openai-429-quota/);
  assert.match(r.stdout, /result\.stream/);
  assert.doesNotMatch(r.stdout, /WARN/);
});

test("no textStream note with an onError, a stream loop, textStream in a comment or string, or no streamText", () => {
  const dir = nested({
    "package.json": PKG,
    "src/a.ts": AI_ROUTE + "const r = streamText({ model: openai(\"x\"), prompt: \"hi\", onError: ({ error }) => { failed = error; } });\nfor await (const c of r.textStream) out += c;\n",
    "src/b.ts": AI_ROUTE + "const r = streamText({ model: openai(\"x\"), prompt: \"hi\" });\nfor await (const p of r.stream) { if (p.type === \"error\") throw p.error; }\n// for await (const c of r.textStream) out += c;\nconst doc = \"for await (const c of r.textStream)\";\n",
    "src/c.ts": "import { streamObject } from \"ai\";\nconst r = streamObject({});\nfor await (const c of r.textStream) out += c;\n",
  });
  const r = run([dir, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).findings.filter((f) => /textStream/.test(f.title)), []);
});

test("Stripe No such price / No such customer (test and live mixed) matches the no-such-price fix first", () => {
  for (const text of [
    "No such price: 'price_1Abc'; a similar object exists in test mode, but a live mode key was used to make this request.",
    "StripeInvalidRequestError: No such customer: 'cus_Q1w2e3'; code: resource_missing",
  ]) {
    const r = run([text]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout.split("\n").find((l) => /^1\. /.test(l)), /No such price \/ No such customer/, text);
    assert.match(r.stdout, /fix\/stripe\/no-such-price/);
  }
});

test("a Stripe price id written into code is a note with file:line (test mode ids fail in live mode)", () => {
  const dir = nested({
    "package.json": PKG,
    "src/app/api/checkout/route.ts": "import Stripe from \"stripe\";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nexport async function POST() {\n  return stripe.checkout.sessions.create({ mode: \"subscription\", line_items: [{ price: \"price_1URG2uRFS02Lh8PfIaO63DWB\", quantity: 1 }] });\n}\n",
  });
  const r = run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /INFO\s+Stripe price id written into code: src\/app\/api\/checkout\/route\.ts:4/);
  assert.match(r.stdout, /fix\/stripe\/no-such-price/);
  assert.doesNotMatch(r.stdout, /price_1URG2uRFS02Lh8PfIaO63DWB/);
  assert.doesNotMatch(r.stdout, /WARN|LEAK/);
});

test("no price id note for env vars, ids quoted inside longer text, comments, short placeholders or test files", () => {
  const dir = nested({
    "package.json": PKG,
    "src/a.ts": "const price = process.env.STRIPE_PRICE_ID!;\n// e.g. \"price_1URG2uRFS02Lh8PfIaO63DWB\"\n/* \"price_1URG2uRFS02Lh8PfIaO63DWB\" */\n",
    "src/b.ts": "export const msg = \"No such price: 'price_1URG2uRFS02Lh8PfIaO63DWB'; a similar object exists in test mode\";\nexport const ph = \"price_123\";\n",
    "tests/checkout.test.ts": "const id = \"price_1URG2uRFS02Lh8PfIaO63DWB\";\n",
    "src/lib/stripe.spec.ts": "const id = 'price_1URG2uRFS02Lh8PfIaO63DWB';\n",
  });
  const r = run([dir, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).findings.filter((f) => /price id/.test(f.title)), []);
});
