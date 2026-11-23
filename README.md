# vibeboot-doctor

Checks a Next.js project for the mistakes AI coding agents make most, and matches pasted errors against 78 verified fixes for Next.js, Auth.js, Prisma and Stripe.

```bash
# in your project folder
npx github:vibeboot/vibeboot-doctor

# got an error? paste it
npx github:vibeboot/vibeboot-doctor "Error: Event handlers cannot be passed to Client Component props."

# or pipe a failing build into it
npm run build 2>&1 | npx github:vibeboot/vibeboot-doctor -
```

Node 18 or newer. No dependencies. It runs offline, uploads nothing, and never prints a secret: env values are masked (`sk_live_••••1234`).

## What it checks

| Check | Why it matters |
| --- | --- |
| Secret keys behind `NEXT_PUBLIC_` (Stripe, OpenAI, Anthropic, database URLs and more) in your `.env*` files | Next.js ships every `NEXT_PUBLIC_` value to the browser |
| `.env` files committed to git, or missing from `.gitignore` | One `git add .` and your keys are public |
| `NEXT_PUBLIC_` values destructured from `process.env` (`const { NEXT_PUBLIC_API_URL } = process.env`) in your source files | Next.js only inlines `process.env.NEXT_PUBLIC_NAME` written out in full, so these are `undefined` in the browser |
| AI SDK streaming routes (`streamText` and friends) with `export const maxDuration` under 60 seconds or `runtime = "edge"` | Vercel counts streaming time, so long answers stop halfway; Edge must start responding within 25 seconds |
| `for await` loops over `streamText(...).textStream` in a file with no `onError` | `textStream` skips error parts, so a wrong API key, no credits (OpenAI 429 `insufficient_quota`) or an outage ends as a blank answer and your `catch` never runs |
| Stripe `price_` ids written into code as a whole string (test files skipped) | Test mode and live mode are separate, so a test price id fails in production with `No such price` and checkout breaks |
| Personal Claude Code files (`.claude/settings.local.json`, `CLAUDE.local.md`) committed or not in `.gitignore` | They hold your own allowed commands and notes, not team rules |
| `middleware.ts` on Next.js 16 | Renamed to `proxy.ts`; agents keep writing the old file |
| `next` as a range or `latest`, and `next` / `eslint-config-next` drift | Each install can build against a different Next.js |
| NextAuth v4 vs Auth.js v5 (and the v4 Prisma adapter) | Agents mix the two APIs |
| `prisma generate` missing from build/postinstall, CLI and client version drift | The classic Vercel "outdated Prisma Client" error |
| Stripe installed | Points you at the raw-body check for webhook signatures |

Each finding links to the full write-up at [vibeboot.dev/fix](https://vibeboot.dev/fix?ref=github), with a copy-paste prompt for your agent.

Exit code is `1` when it finds a leak (or no error match), so you can drop it into CI. `--json` prints machine-readable output.

## Where the fixes come from

Every entry is the same data as the free web tools at [vibeboot.dev/tools/doctor](https://vibeboot.dev/tools/doctor?ref=github), each reproduced and checked against the versions listed in its output (for example Next.js 16.4.5). `bin/vibeboot-doctor.mjs` is a single bundled file; `src/cli.ts` is its entry point.

## GitHub Action

Drop it into CI so every pull request fails when an agent leaks a secret or writes `middleware.ts` on Next.js 16.

```yaml
# .github/workflows/vibeboot-doctor.yml
name: VibeBoot Doctor
on: pull_request
jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vibeboot/vibeboot-doctor@0359af0a8d50cd39ec69e19b148b0aa0f9ea91e9 # v0.1.14
```

The example pins a full commit SHA, so a new Doctor version never changes your CI until you bump it. To update, swap in the SHA of a newer commit from the [commit list](https://github.com/vibeboot/vibeboot-doctor/commits/main). If you'd rather always run the latest, use `@main`.

What it does: checks out the PR, runs the bundled `bin/vibeboot-doctor.mjs` from the exact ref you pinned (no npx fetch) on the working tree, and exits `1` on a leak (same as the CLI). Optional `json: "true"` input for machine-readable output. No secrets, no telemetry, MIT.

An example workflow lives at [`.github/workflows/vibeboot-doctor.yml`](.github/workflows/vibeboot-doctor.yml). Full write-up: [vibeboot.dev/tools/doctor](https://vibeboot.dev/tools/doctor?ref=github).

## Made by VibeBoot

Free and MIT. If you'd rather start from a project where all of this is already handled, the [VibeBoot starters](https://vibeboot.dev/?ref=github#starters) are Next.js 16 + Auth.js + Prisma + Stripe kits with Cursor rules that stop agents re-breaking it.
