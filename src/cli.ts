// vibeboot-doctor: the VibeBoot Doctor (vibeboot.dev/tools/doctor) as a local CLI.
// Same data as the web tool: every check and fix comes from the site's src/lib files, bundled at build time.
// No network calls, no telemetry, never prints a secret value (env values are masked).
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { matchErrors, checkPackageJson, checkEnv, looksLikeMiddleware, checkMiddleware, ENTRY_COUNT, type Hit, type PkgFinding } from "@/lib/doctor";

const VERSION = "0.1.8";
const SITE = "https://vibeboot.dev";
const ref = (p: string) => /^https?:\/\//i.test(p) ? p : `${SITE}${p}${p.includes("?") ? "&" : "?"}ref=cli`;
const fixUrl = (h: { tool: string; id: string }) => ref(`/fix/${h.tool}/${h.id}`);

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("38;2;57;255;20"), red = c("31"), yellow = c("33"), dim = c("2"), bold = c("1");
const out: string[] = [];
const say = (s = "") => out.push(s);
const wrap = (s: string, ind = "    ", w = Math.min(process.stdout.columns || 88, 100)) => {
  const words = s.split(/\s+/); const lines: string[] = []; let cur = "";
  for (const wd of words) { if ((ind + cur + " " + wd).length > w && cur) { lines.push(ind + cur); cur = wd; } else cur = cur ? cur + " " + wd : wd; }
  if (cur) lines.push(ind + cur); return lines.join("\n");
};
const tag = { warn: yellow("WARN"), info: dim("INFO"), ok: green(" OK "), leak: red("LEAK") } as const;

function help() {
  console.log(`${bold("vibeboot-doctor")} ${VERSION}: checks a Next.js project for the mistakes AI coding agents make most.

Usage
  npx github:vibeboot/vibeboot-doctor            scan the project in this folder
  npx github:vibeboot/vibeboot-doctor <dir>      scan another folder
  npx github:vibeboot/vibeboot-doctor "<error>"  match a pasted error against ${ENTRY_COUNT} known fixes
  some-command 2>&1 | npx github:vibeboot/vibeboot-doctor -   match errors from stdin

Options
  --json      machine-readable output
  --no-color  plain text (or set NO_COLOR)
  -h, --help  this help

Runs offline. Never uploads anything and never prints secret values.
Web version: ${SITE}/tools/doctor`);
}

function printHit(h: Hit, i: number) {
  say(`${green(`${i + 1}.`)} ${bold(h.name)} ${dim(`(${h.fixer}, ${h.where})`)}`);
  say(wrap(h.means));
  h.fix.forEach((f) => say(wrap(`- ${f}`, "    ")));
  if (h.code) { say(dim(`    ${h.code.file}:`)); h.code.body.split("\n").forEach((l) => say(dim(`      ${l}`))); }
  say(`    ${dim("Prompt for your agent:")}`);
  say(wrap(h.prompt, "      "));
  say(`    ${dim("Verified on")} ${h.versions}, ${h.verified}. ${dim("Full fix:")} ${fixUrl(h)}`);
  say();
}

function errorMode(text: string, json: boolean) {
  const hits = matchErrors(text, 3);
  if (json) { console.log(JSON.stringify({ mode: "error", matches: hits.map((h) => ({ ...h, url: fixUrl(h) })) }, null, 2)); return hits.length ? 0 : 1; }
  if (!hits.length) {
    say(`No match among ${ENTRY_COUNT} known Next.js, Auth.js, Prisma and Stripe webhook errors.`);
    say(dim(`Paste the first error line plus a few lines after it. Browse every fix: ${ref("/fix")}`));
  } else {
    say(bold(`Best match${hits.length > 1 ? "es" : ""} for your error:`)); say();
    hits.forEach(printHit);
  }
  return hits.length ? 0 : 1;
}

type Finding = { severity: "leak" | "warn" | "info" | "ok"; title: string; detail: string; fix?: string[]; url?: string; file?: string };

function readIf(p: string) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }

function gitTracked(dir: string, files: string[]): string[] {
  // No .env files on disk: nothing to check. (An empty pathspec would make
  // `git ls-files --` list every tracked file and report them all as leaks.)
  if (!files.length) return [];
  try {
    const r = execFileSync("git", ["-C", dir, "ls-files", "--", ...files], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return r.split("\n").filter(Boolean);
  } catch { return []; }
}

/** Is `dir` inside a git work tree? */
function inGitRepo(dir: string) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
  } catch { return false; }
}

/** Env files git would NOT ignore (asks git itself, so nested .gitignore files, negations and globs all count). */
function gitNotIgnored(dir: string, files: string[]): string[] | null {
  if (!files.length) return [];
  try {
    // check-ignore prints the paths that ARE ignored; exit 1 just means "none of them".
    const r = spawnSync("git", ["-C", dir, "check-ignore", "--", ...files], { encoding: "utf8" });
    if (r.status !== 0 && r.status !== 1) return null;
    const ignored = new Set(r.stdout.split("\n").filter(Boolean));
    return files.filter((f) => !ignored.has(f));
  } catch { return null; }
}

/**
 * No git repo yet: read .gitignore ourselves (last matching line wins, "!" re-includes). Simple globs only.
 * A pattern without a slash matches a file or folder name at any depth; one with a slash matches the path from
 * the root; a trailing slash only matches folders. `file` is relative to the project root, e.g. ".claude/x.json".
 */
function gitignoreCovers(gitignore: string, file: string) {
  const parts = file.split("/");
  let ignored = false;
  for (const raw of gitignore.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    line = line.replace(/^\//, "").replace(/\/$/, "").replace(/^\*\*\//, "");
    const anchored = line.includes("/");
    const re = new RegExp("^" + line.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]") + "$");
    // Every folder on the way to the file, then the file itself: ignoring a folder ignores what's inside it.
    const hit = parts.some((_, i) => {
      if (dirOnly && i === parts.length - 1) return false;
      return re.test(anchored ? parts.slice(0, i + 1).join("/") : parts[i]);
    });
    if (hit) ignored = !negate;
  }
  return ignored;
}

/* NEXT_PUBLIC_ values read by destructuring process.env. Next.js only replaces process.env.NEXT_PUBLIC_NAME at build
 * time; on Next.js 16.4.5 (Turbopack and webpack, Nov 19, 2026) `const { NEXT_PUBLIC_X } = process.env` stayed a runtime
 * lookup, so it is undefined in the browser. Server code still sees the value, so only "use client" files are warnings. */
const SRC_SKIP = new Set(["node_modules", ".next", ".git", "out", "build", "dist", "coverage", ".vercel", ".turbo", ".netlify", "public"]);
const SRC_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
export function findEnvDestructures(text: string): { line: number; names: string[] }[] {
  const hits: { line: number; names: string[] }[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));
  const re = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b(?!\s*\.)/g;
  for (let m; (m = re.exec(code)); ) {
    const names = [...new Set((m[1].match(/\bNEXT_PUBLIC_[A-Za-z0-9_]+/g) ?? []))];
    if (names.length) hits.push({ line: code.slice(0, m.index).split("\n").length, names });
  }
  return hits;
}
export const isClientFile = (text: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(text);
function sourceFiles(root: string, max = 4000): string[] {
  const outFiles: string[] = []; const stack = [""];
  while (stack.length && outFiles.length < max) {
    const rel = stack.pop()!; let ents: fs.Dirent[];
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SRC_SKIP.has(e.name) && !e.name.startsWith(".")) stack.push(r); }
      else if (e.isFile() && SRC_EXT.test(e.name) && !/\.d\.ts$/.test(e.name)) outFiles.push(r);
    }
  }
  return outFiles.sort();
}

function projectMode(dir: string, json: boolean) {
  const abs = path.resolve(dir);
  const pkgText = readIf(path.join(abs, "package.json"));
  if (pkgText == null) { console.error(`No package.json in ${abs}. Run this in your project folder, or pass an error message in quotes.`); return 2; }
  const findings: Finding[] = [];
  const pkg = checkPackageJson(pkgText);
  let stack: string[] = [];
  if ("error" in pkg) findings.push({ severity: "warn", title: "package.json didn't parse", detail: pkg.error, file: "package.json" });
  else {
    stack = pkg.stack;
    pkg.findings.forEach((f: PkgFinding) => findings.push({ severity: f.severity, title: f.title, detail: f.detail, fix: f.fix, file: "package.json", url: f.entry && f.link ? ref(f.link.href.startsWith("/tools/") && f.link.href.includes("#") ? `/fix/${toolOf(f.link.href)}/${f.entry}` : f.link.href) : f.link ? ref(f.link.href) : undefined }));
  }

  // .env files: masked findings only
  const envNames = fs.readdirSync(abs).filter((n) => /^\.env(\..+)?$/.test(n) && !/\.(example|sample|template)$/.test(n));
  let leaks = 0;
  for (const n of envNames) {
    const t = readIf(path.join(abs, n)); if (t == null) continue;
    const r = checkEnv(t); leaks += r.leaks;
    r.findings.forEach((f) => findings.push({ severity: f.severity === "leak" ? "leak" : "warn", title: `${n}:${f.line} ${f.key} (${f.masked})`, detail: `${f.title}. ${f.detail}`, fix: f.fix ? [f.fix] : undefined, file: n, url: ref("/tools/env-leak-checker") }));
  }
  const tracked = gitTracked(abs, envNames);
  if (tracked.length)
    findings.push({ severity: "leak", title: `Committed to git: ${tracked.join(", ")}`, detail: "Anyone with the repo can read these values. Remove the file from git, add .env* to .gitignore, and rotate every key that was in it (it stays in git history).", fix: [`git rm --cached ${tracked.join(" ")}`, "echo '.env*' >> .gitignore  (keep .env.example if you have one: add !.env.example)", "Rotate the keys in each provider's dashboard"], url: ref("/tools/env-leak-checker") });
  else if (envNames.length) {
    // Ask git when we can: a rule like ".env*.local" (the old create-next-app default) mentions .env but
    // doesn't cover .env itself, so the next git add . would still commit it.
    const exposed = (inGitRepo(abs) ? gitNotIgnored(abs, envNames) : null)
      ?? envNames.filter((n) => !gitignoreCovers(readIf(path.join(abs, ".gitignore")) ?? "", n));
    if (exposed.length) findings.push({ severity: "warn", title: `.gitignore doesn't cover ${exposed.join(", ")}`, detail: `${exposed.join(", ")} ${exposed.length === 1 ? "isn't" : "aren't"} ignored by git, so one git add . would commit your secrets.${exposed.includes(".env") ? " A rule like .env*.local only covers the .local files." : ""}`, fix: ["Add .env* to .gitignore (and !.env.example to keep the example)", "Check with: git check-ignore -v .env"], file: ".gitignore", url: ref("/tools/env-leak-checker") });
  }

  // Personal Claude Code files. CLAUDE.md setups (ours included) put personal overrides in .claude/settings.local.json
  // and personal notes in CLAUDE.local.md. Claude Code only gitignores settings.local.json when it creates the file
  // itself, so a hand-made one (or CLAUDE.local.md) goes out with the next git add .
  const personal = [".claude/settings.local.json", "CLAUDE.local.md"].filter((n) => fs.existsSync(path.join(abs, n)));
  const personalTracked = gitTracked(abs, personal);
  if (personalTracked.length)
    findings.push({ severity: "warn", title: `Personal Claude Code file committed: ${personalTracked.join(", ")}`, detail: "These hold your own permissions, allowed commands and notes, not team rules, so they don't belong in the repo (allowed commands can include tokens or private paths). Teammates also get your overrides.", fix: [`git rm --cached ${personalTracked.join(" ")}`, `Add ${personalTracked.join(" and ")} to .gitignore`, "Shared rules go in AGENTS.md or .claude/settings.json instead"], file: ".gitignore" });
  else if (personal.length) {
    const exposed = (inGitRepo(abs) ? gitNotIgnored(abs, personal) : null)
      ?? personal.filter((n) => !gitignoreCovers(readIf(path.join(abs, ".gitignore")) ?? "", n));
    if (exposed.length) findings.push({ severity: "warn", title: `.gitignore doesn't cover ${exposed.join(", ")}`, detail: `${exposed.length === 1 ? "This is a personal Claude Code file" : "These are personal Claude Code files"} (your own permissions, allowed commands or notes), so one git add . would commit ${exposed.length === 1 ? "it" : "them"} for everyone.`, fix: [`Add ${exposed.join(" and ")} to .gitignore`, `Check with: git check-ignore -v ${exposed[0]}`], file: ".gitignore" });
  }

  // NEXT_PUBLIC_ destructured from process.env (undefined in the browser)
  const client: string[] = [], server: string[] = [];
  for (const f of sourceFiles(abs)) {
    let t: string | null = null;
    try { if (fs.statSync(path.join(abs, f)).size <= 512_000) t = readIf(path.join(abs, f)); } catch { /* unreadable */ }
    if (t == null || !t.includes("NEXT_PUBLIC_")) continue;
    for (const h of findEnvDestructures(t)) (isClientFile(t) ? client : server).push(`${f}:${h.line} (${h.names.join(", ")})`);
  }
  const envFix = ["Write each one out in full, e.g. const apiUrl = process.env.NEXT_PUBLIC_API_URL", "Then rebuild: the value is copied in when next build runs"];
  const where = (l: string[]) => l.slice(0, 3).join("; ") + (l.length > 3 ? `; and ${l.length - 3} more` : "");
  if (client.length) findings.push({ severity: "warn", title: `NEXT_PUBLIC_ destructured from process.env in a client file: ${where(client)}`, detail: "Next.js only swaps in NEXT_PUBLIC_ values written out as process.env.NEXT_PUBLIC_NAME. Destructured like this, the value is undefined in the browser (checked on Next.js 16.4.5 with Turbopack and webpack).", fix: envFix, file: client[0].split(":")[0], url: ref("/fix/nextjs/next-public-env-undefined") });
  if (server.length) findings.push({ severity: "info", title: `NEXT_PUBLIC_ destructured from process.env: ${where(server)}`, detail: "Fine in server only code, but if this file is ever imported by a \"use client\" component the value is undefined in the browser. Next.js only swaps in values written out as process.env.NEXT_PUBLIC_NAME.", fix: envFix.slice(0, 1), file: server[0].split(":")[0], url: ref("/fix/nextjs/next-public-env-undefined") });

  // middleware.ts on Next.js 16
  for (const n of ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"]) {
    const t = readIf(path.join(abs, n)); if (t == null || !looksLikeMiddleware(t)) continue;
    const next16 = !("error" in pkg) && pkg.findings.some((f) => f.entry === "middleware-to-proxy");
    if (!next16) continue;
    const r = checkMiddleware(t);
    findings.push({ severity: "warn", title: `${n} should be ${n.replace("middleware", "proxy")} on Next.js 16`, detail: `Next.js 16 renamed middleware to proxy. ${r.changes.length} change${r.changes.length === 1 ? "" : "s"} needed: ${r.changes.map((x) => x.title).join("; ")}.`, fix: ["Paste the file into the converter for the rewritten proxy.ts and a diff"], file: n, url: ref("/tools/middleware-to-proxy") });
  }
  // drop the generic "middleware is now proxy" info when we found the real file, or when there's no middleware at all
  const hasMw = findings.some((f) => /should be .*proxy/.test(f.title));
  const hasProxy = ["proxy.ts", "proxy.js", "src/proxy.ts", "src/proxy.js"].some((n) => fs.existsSync(path.join(abs, n)));
  const list = findings.filter((f) => !(f.title === "Next.js 16: middleware.ts is now proxy.ts" && (hasMw || hasProxy)));

  const order = { leak: 0, warn: 1, info: 2, ok: 3 } as const;
  list.sort((a, b) => order[a.severity] - order[b.severity]);
  const n = (s: Finding["severity"]) => list.filter((f) => f.severity === s).length;
  if (json) { console.log(JSON.stringify({ mode: "project", dir: abs, stack, findings: list }, null, 2)); return n("leak") ? 1 : 0; }

  say(`${bold("VibeBoot Doctor")} ${dim(VERSION)}  ${abs}`);
  say(dim(`Stack: ${stack.join(", ") || "unknown"}. Checked package.json${envNames.length ? ", " + envNames.join(", ") : ""}${hasMw ? ", middleware" : ""}, source files. Nothing left this machine.`));
  say();
  for (const f of list) {
    say(`${tag[f.severity]}  ${bold(f.title)}`);
    say(wrap(f.detail, "      "));
    f.fix?.forEach((x) => say(wrap(`- ${x}`, "      ")));
    if (f.url) say(`      ${dim(f.url)}`);
    say();
  }
  const summary = `${n("leak")} leak${n("leak") === 1 ? "" : "s"}, ${n("warn")} warning${n("warn") === 1 ? "" : "s"}, ${n("info")} note${n("info") === 1 ? "" : "s"}, ${n("ok")} ok`;
  say((n("leak") ? red : n("warn") ? yellow : green)(bold(summary)));
  say(dim(`Got an error instead? npx github:vibeboot/vibeboot-doctor "<paste the error>"`));
  return n("leak") ? 1 : 0;
}

function toolOf(href: string) {
  const m = /\/tools\/(nextjs|authjs|prisma|stripe-webhook)/.exec(href); const t = m?.[1] ?? "nextjs";
  return t === "stripe-webhook" ? "stripe" : t;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rest = args.filter((a) => !["--json", "--no-color"].includes(a));
  if (rest.includes("-h") || rest.includes("--help")) { help(); return 0; }
  if (rest.includes("-v") || rest.includes("--version")) { console.log(VERSION); return 0; }
  let code: number;
  if (rest[0] === "-") {
    const chunks: Buffer[] = []; for await (const ch of process.stdin) chunks.push(ch as Buffer);
    code = errorMode(Buffer.concat(chunks).toString("utf8"), json);
  } else if (rest.length && !(fs.existsSync(rest[0]) && fs.statSync(rest[0]).isDirectory())) {
    code = errorMode(rest.join(" "), json);
  } else code = projectMode(rest[0] ?? ".", json);
  if (!json) {
    say(dim(`Want these handled from day one? VibeBoot starters (SaaS $49, AI Chatbot $59, one-time): ${SITE}/?ref=doctor-cli#starters`));
    console.log(out.join("\n"));
  }
  return code;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
