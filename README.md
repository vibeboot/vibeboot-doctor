# vibeboot-doctor

Checks a Next.js project for the mistakes AI coding agents make most, and matches pasted errors against 70 verified fixes for Next.js, Auth.js, Prisma and Stripe webhooks.

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
| `middleware.ts` on Next.js 16 | Renamed to `proxy.ts`; agents keep writing the old file |
| `next` as a range or `latest`, and `next` / `eslint-config-next` drift | Each install can build against a different Next.js |
| NextAuth v4 vs Auth.js v5 (and the v4 Prisma adapter) | Agents mix the two APIs |
| `prisma generate` missing from build/postinstall, CLI and client version drift | The classic Vercel "outdated Prisma Client" error |
| Stripe installed | Points you at the raw-body check for webhook signatures |

Each finding links to the full write-up at [vibeboot.dev/fix](https://vibeboot.dev/fix?ref=github), with a copy-paste prompt for your agent.

Exit code is `1` when it finds a leak (or no error match), so you can drop it into CI. `--json` prints machine-readable output.

## Where the fixes come from

Every entry is the same data as the free web tools at [vibeboot.dev/tools/doctor](https://vibeboot.dev/tools/doctor?ref=github), each reproduced and checked against the versions listed in its output (for example Next.js 16.4.5). `bin/vibeboot-doctor.mjs` is a single bundled file; `src/cli.ts` is its entry point.

## Made by VibeBoot

Free and MIT. If you'd rather start from a project where all of this is already handled, the [VibeBoot starters](https://vibeboot.dev/?ref=github#starters) are Next.js 16 + Auth.js + Prisma + Stripe kits with Cursor rules that stop agents re-breaking it.
