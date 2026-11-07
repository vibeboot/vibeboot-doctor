#!/usr/bin/env node

// ../vibeboot-doctor/src/cli.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// src/lib/nextjs-errors.ts
var CHECKED_ON = "October 24, 2026";
var CHECKED_ISO = "2026-10-24";
var VERSIONS = "Next.js 16.4.3 \xB7 React 19.3";
var NEXT_ERRORS = [
  {
    id: "hook-in-server-component",
    agent: true,
    quick: 'move the hook into a "use client" component',
    name: "useState / useEffect in a Server Component",
    where: "build error",
    looksLike: 'Error: You\'re importing a module that depends on `useState` into a React Server Component module. This API is only available in Client Components. To fix, mark the file (or its parent) with the `"use client"` directive.',
    match: ["into a react server component module", "only available in client components", "depends on `usestate`", "depends on `useeffect`", "usestate", "useeffect", "useref", "usecontext", "createcontext"],
    means: 'Every file in the App Router is a Server Component unless it (or a file that imports it) starts with "use client". Hooks like useState, useEffect, useRef and createContext only work in Client Components.',
    causes: ["The agent added state or an effect to a page.tsx or layout.tsx", "A component from a tutorial written for the Pages Router", "A context provider placed straight into layout.tsx"],
    fix: ['Move the interactive part into its own file that starts with "use client"', "Keep page.tsx a Server Component and render the new component from it", `Don't mark the whole page "use client" just to silence the error: you lose server data fetching and metadata`],
    code: { file: "src/components/counter.tsx", body: '"use client";\n\nimport { useState } from "react";\n\nexport function Counter() {\n  const [n, setN] = useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}' },
    prompt: `Next.js build fails because a Server Component imports a client-only hook. Find the component that uses the hook, move only the interactive part into a new file that starts with "use client", and keep page.tsx and layout.tsx as Server Components. Don't add "use client" to the page itself.`
  },
  {
    id: "event-handlers",
    agent: true,
    quick: "put the onClick inside a Client Component",
    name: "Event handlers cannot be passed to Client Component props",
    where: "next build (prerender)",
    looksLike: 'Error occurred prerendering page "/pricing".\nError: Event handlers cannot be passed to Client Component props.\n  {onClick: function onClick, children: ...}\n            ^^^^^^^^^^^^^^^^\nIf you need interactivity, consider converting part of this to a Client Component.',
    match: ["event handlers cannot be passed to client component props", "if you need interactivity, consider converting", "onclick: function", "onchange: function", "onsubmit: function"],
    means: `A Server Component rendered an element with onClick, onChange or any prop starting with "on" set to a function. Functions can't be sent from the server to the browser, so rendering stops.`,
    causes: ["onClick added to a <button> directly in page.tsx", "A Server Component passes onSomething={() => \u2026} to a Client Component", "It often only shows up at next build, when the page is prerendered"],
    fix: ['Move the button (and its handler) into a "use client" component', "Or keep it on the server: use a <form action={serverAction}> instead of onClick", "If the child is already a Client Component, define the handler inside it instead of passing it down"],
    prompt: 'next build fails with "Event handlers cannot be passed to Client Component props". Find the Server Component that sets an on* prop to a function, and either move that element into a "use client" component or replace the handler with a Server Action used as a form action. Show me the diff.'
  },
  {
    id: "functions-to-client",
    name: "Functions cannot be passed directly to Client Components",
    where: "next build (prerender)",
    looksLike: 'Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server". Or maybe you meant to call this function rather than return it.',
    match: ["functions cannot be passed directly to client components", 'unless you explicitly expose it by marking it with "use server"', "or maybe you meant to call this function"],
    means: "Same rule as above for props not named on*: a Server Component passed a plain function (a formatter, a callback, a render prop) to a Client Component.",
    causes: ["formatPrice={(n) => \u2026} passed from a page to a client chart or table", "A render prop like renderItem from a Server Component", "Passing a function reference when you meant to pass its result"],
    fix: ["Pass data, not functions: call the function on the server and pass the result", "Or import the helper directly inside the Client Component", 'If it must run on the server when the client calls it, make it a Server Action in a "use server" file'],
    prompt: "A Server Component passes a function prop to a Client Component and Next.js refuses to serialize it. Find it, then either pass the computed value instead, import the helper inside the client file, or turn it into a Server Action if it needs server access."
  },
  {
    id: "plain-objects",
    name: "Only plain objects can be passed to Client Components",
    where: "next build (prerender)",
    looksLike: "Error: Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.\n  {v: {c: 5}}\n      ^^^^^^",
    match: ["only plain objects, and a few built-ins, can be passed to client components", "classes or null prototypes are not supported", "only plain objects"],
    means: "Props going from a Server Component to a Client Component are serialized. Class instances can't be: Prisma Decimal values, SDK objects (a Stripe or OpenAI response object), Mongoose documents, or your own classes.",
    causes: ["Passing a Prisma row with a Decimal column straight to a client table", "Passing a whole SDK response object instead of the fields you need", "Objects created with Object.create(null)"],
    fix: ["Map to plain fields before passing: { id, name, price: Number(row.price) }", "Convert Decimal with .toNumber() or .toString()", "Only pass what the client actually renders"],
    code: { file: "src/app/dashboard/page.tsx", body: "const rows = await db.product.findMany();\n- return <Table rows={rows} />\n+ return <Table rows={rows.map((r) => ({ id: r.id, name: r.name, price: r.price.toNumber() }))} />" },
    prompt: "Next.js says only plain objects can be passed to Client Components. Find the prop that carries a class instance (Prisma Decimal, an SDK object or a custom class) and map it to plain serializable fields on the server before passing it down."
  },
  {
    id: "use-client-position",
    agent: true,
    quick: 'move "use client" to line 1',
    name: '"use client" must be placed before other expressions',
    where: "build error",
    looksLike: 'Error: The "use client" directive must be placed before other expressions. Move it to the top of the file to resolve this issue.',
    match: ["directive must be placed before other expressions", "move it to the top of the file", '"use client" directive'],
    means: "The directive only counts as the very first statement in the file. If an import comes first, the file silently stays a Server Component and this error (often with a hook error next to it) appears.",
    causes: ['An agent inserted imports above "use client"', "A license header or 'use strict' line above it (comments are fine, code isn't)"],
    fix: ['Make "use client" the first line of the file, above all imports', "Re-run the build: any hook errors from the same file usually disappear too"],
    prompt: `Next.js says the "use client" directive must be placed before other expressions. Move it to line 1 of every file where it's below an import, and don't change anything else.`
  },
  {
    id: "metadata-in-client",
    name: 'export "metadata" from a "use client" page',
    where: "build error",
    looksLike: 'Error: You are attempting to export "metadata" from a component marked with "use client", which is disallowed. "metadata" must be resolved on the server before the page component is rendered. Keep your page as a Server Component and move Client Component logic to a separate file.',
    match: ['you are attempting to export "metadata"', 'you are attempting to export "generatemetadata"', "must be resolved on the server before the page component is rendered", "you are attempting to export"],
    means: `metadata and generateMetadata only work in Server Components. Once a page has "use client" at the top, it can't export them.`,
    causes: ["The page was turned into a Client Component to fix a hook error", "An agent added SEO metadata to an existing client page"],
    fix: ['Remove "use client" from page.tsx so it can export metadata', 'Move the interactive part into a separate "use client" component and render it from the page'],
    prompt: 'Next.js refuses to export metadata from a "use client" page. Split it: keep page.tsx as a Server Component that exports metadata, and move the interactive code into a new client component file it renders.'
  },
  {
    id: "async-client-component",
    name: "async Client Component",
    where: "browser console",
    looksLike: "Dashboard is an async Client Component. Only Server Components can be async at the moment. This error is often caused by accidentally adding `'use client'` to a module that was originally written for the server.",
    match: ["is an async client component", "only server components can be async", "accidentally adding `'use client'`", "async client component"],
    means: `Client Components can't be async functions. This usually means "use client" was added to a component that awaits data on the server. It can build fine and only fail in the browser.`,
    causes: ['"use client" added to an async page or component to fix a hook error', "await fetch() or await db\u2026 inside a client file"],
    fix: ['Keep the async data loading in a Server Component (no "use client")', "Pass the loaded data as props to a small client component for the interactive bits", "In a Client Component, read a promise passed from the server with React's use() inside <Suspense>"],
    prompt: 'React says a component is an async Client Component. Find it, remove "use client" if it fetches data on the server, and move any hooks or event handlers into a separate client child that receives the data as props.'
  },
  {
    id: "server-only-in-client",
    name: "'server-only' cannot be imported from a Client Component module",
    where: "build error",
    looksLike: `Error: You're importing a module that depends on "server-only" into a React Client Component module. This API is only available in Server Components but one of its parents is marked with "use client", so this module is also a Client Component.`,
    match: ["'server-only' cannot be imported from a client component module", 'depends on "server-only"', "server-only", "into a react client component module"],
    means: 'A file marked with import "server-only" (on purpose, to keep secrets on the server) ended up in a client bundle. Any file a "use client" file imports becomes client code too.',
    causes: ["A client component imports a helper from lib/ that reads env secrets or the database", "A shared utils file mixes client-safe helpers and server-only ones"],
    fix: ["Don't import that module from the client: call it from a Server Component or Server Action instead", "Split the file: client-safe helpers in one module, server-only code in another", `Keep the import "server-only" line: it's what caught the leak`],
    prompt: 'Next.js blocks a "server-only" module from a Client Component. Show me the import chain from the "use client" file to that module, then split or move the code so the client only gets what it needs through props or a Server Action. Keep the server-only guard.'
  },
  {
    id: "module-not-found-fs",
    agent: true,
    quick: "keep Node APIs in server code",
    name: "Module not found: Can't resolve 'fs'",
    where: "build error",
    looksLike: `./src/app/blog/page.tsx:2:1
Error: Module not found: Can't resolve 'fs'
> 2 | import fs from "fs";`,
    match: ["can't resolve 'fs'", "can't resolve 'path'", "can't resolve 'net'", "can't resolve 'tls'", "can't resolve 'child_process'", "can't resolve 'crypto'", "can't resolve 'node:", "module not found"],
    means: "Code that uses a Node.js API (fs, path, net, tls, child_process) is being bundled for the browser, where those modules don't exist.",
    causes: ['fs or path used inside a "use client" file', "A client component imports a helper that reads files, or a Node-only package (database drivers, nodemailer)", "A typo in an import path also gives Module not found, for your own files"],
    fix: ["Read files or call Node APIs in a Server Component, route handler or Server Action", "Pass the result to the client component as props", 'Add import "server-only" to modules that must never reach the browser'],
    prompt: `Next.js can't resolve a Node built-in (like fs) in the browser bundle. Trace which "use client" file imports it, move the Node code into a Server Component or Server Action, and add import "server-only" to that module.`
  },
  {
    id: "prisma-in-browser",
    name: "PrismaClient is unable to run in this browser environment",
    where: "browser console",
    looksLike: "Error: PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `Chrome`).",
    match: ["prismaclient is unable to run in this browser environment", "has been bundled for the browser", "prismaclient is unable"],
    means: "A Client Component imports your database client (often through lib/db.ts). Database code can only run on the server.",
    causes: ['A "use client" component imports db from @/lib/db', "A shared file exports both db queries and client helpers"],
    fix: ["Query the database in a Server Component or Server Action and pass the rows down as plain objects", 'Add import "server-only" to lib/db.ts so the build fails early next time'],
    code: { file: "src/lib/db.ts", body: 'import "server-only";\nimport { PrismaClient } from "@prisma/client";\n\nexport const db = new PrismaClient();' },
    prompt: 'Prisma is being bundled into the browser. Find which "use client" file imports the database client, move the query into a Server Component or Server Action, and add import "server-only" to the db module.'
  },
  {
    id: "server-actions-async",
    name: "Server Actions must be async functions",
    where: "build error",
    looksLike: "Error: Server Actions must be async functions.",
    match: ["server actions must be async functions", "only async functions are allowed to be exported in a", '"use server" file'],
    means: 'Every function exported from a file that starts with "use server" (or marked "use server" inline) is a Server Action, and Server Actions have to be async.',
    causes: ["A plain helper or constant exported from actions.ts", 'An agent put "use server" at the top of a utils file'],
    fix: ["Make each exported action async", 'Move non-action helpers and constants out of the "use server" file', `Don't use "use server" to mean "server-only": that's what import "server-only" is for`],
    code: { file: "src/app/actions.ts", body: '"use server";\n\n- export function save(formData: FormData) {\n+ export async function save(formData: FormData) {\n    // \u2026\n  }' },
    prompt: 'Next.js says Server Actions must be async. In every "use server" file, make exported actions async and move any non-action exports (helpers, constants, types used at runtime) into a separate module.'
  },
  {
    id: "use-search-params-suspense",
    agent: true,
    quick: "wrap the component in <Suspense>",
    name: "useSearchParams() should be wrapped in a suspense boundary",
    where: "next build (prerender)",
    looksLike: '\u2A2F useSearchParams() should be wrapped in a suspense boundary at page "/login". Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout\nError occurred prerendering page "/login".',
    match: ["should be wrapped in a suspense boundary", "missing-suspense-with-csr-bailout", "usesearchparams()", "usesearchparams"],
    means: "A Client Component reads the URL query with useSearchParams on a page Next.js prerenders. The query isn't known at build time, so Next.js needs a <Suspense> boundary to render a fallback there. next dev doesn't complain; next build does.",
    causes: ["A login or search page reads ?error= or ?q= with useSearchParams", "The hook sits in a component used in layout.tsx, so every page fails"],
    fix: ["Wrap the component that calls useSearchParams in <Suspense> in its parent", "Or read searchParams in the page (a Server Component prop) and pass the value down"],
    code: { file: "src/app/login/page.tsx", body: 'import { Suspense } from "react";\nimport { LoginForm } from "./login-form"; // calls useSearchParams()\n\nexport default function Page() {\n  return (\n    <Suspense fallback={null}>\n      <LoginForm />\n    </Suspense>\n  );\n}' },
    prompt: "next build fails: useSearchParams() should be wrapped in a suspense boundary. Find every component that calls useSearchParams and wrap where it's rendered in <Suspense> with a sensible fallback. Don't make the whole page dynamic to work around it."
  },
  {
    id: "blocking-route",
    agent: true,
    quick: "<Suspense> around it, or export const instant = false",
    name: "Next.js encountered runtime / uncached data during prerendering (cacheComponents)",
    where: "next build (prerender)",
    looksLike: 'Error: Route "/dashboard": Next.js encountered uncached or runtime data during prerendering.\n\n`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of `<Suspense>` prevents the route from being prerendered\u2026\n\nWays to fix this:\n  - [stream] Provide a placeholder with `<Suspense fallback={...}>` around the data access\n  - [cache] \u2026 `"use cache"`\n  - [block] Set `export const instant = false` to allow a blocking route',
    match: ["encountered uncached or runtime data during prerendering", "encountered runtime data during prerendering", "encountered uncached data during prerendering", "blocking-prerender", "accessed outside of `<suspense>`", "export const instant = false", "cachecomponents", "instant-shell-url-data"],
    means: "With cacheComponents on (the Next.js 16 model), every route gets a prerendered shell. Reading cookies(), headers(), params, searchParams, auth() or an uncached database or fetch call outside <Suspense> would block that shell, so the build stops and lists three ways out.",
    causes: ["const session = await auth() at the top of a page", 'A database query in a page with no "use cache" and no <Suspense>', "Reading searchParams in a layout"],
    fix: ["[stream] Move the data access into a child component and wrap it in <Suspense fallback={\u2026}>", `[cache] Add "use cache" to data that's the same for every visitor (not for cookies or auth)`, "[block] For fully per-user pages like a dashboard, add export const instant = false"],
    code: { file: "src/app/dashboard/page.tsx", body: 'import { Suspense } from "react";\n\nexport default function Page() {\n  return (\n    <Suspense fallback={<p>Loading\u2026</p>}>\n      <Account /> {/* awaits auth() and the DB inside */}\n    </Suspense>\n  );\n}\n\n// or, for a page that is per-user anyway:\n// export const instant = false;' },
    prompt: 'next build fails because a route reads runtime or uncached data outside <Suspense> (cacheComponents is on). For this route, move the cookies/auth/DB access into a child component wrapped in <Suspense>, or add "use cache" if the data is the same for everyone, or export const instant = false if the page is fully per-user. Explain which one you picked.'
  },
  {
    id: "params-promise",
    agent: true,
    quick: "const { slug } = await params",
    name: "params.slug is undefined (params is a Promise)",
    where: "silent bug",
    looksLike: `Property 'slug' does not exist on type 'Promise<{ slug: string; }>'.  \xB7  page renders "undefined"`,
    match: ["does not exist on type 'promise<", "params.slug", "params.id", "searchparams.", "params is a promise", "sync-dynamic-apis", "was accessed directly with", "must be unwrapped with"],
    means: `Since Next.js 15, params and searchParams are Promises. Code from older tutorials reads params.slug directly. In our Next.js 16.4.3 test build that didn't fail at all: the page just rendered "undefined".`,
    causes: ["The page is typed { params: { slug: string } } (the old shape), so TypeScript doesn't catch it", "Agents trained on Next.js 13/14 examples", "Same for searchParams, cookies() and headers(): all async now"],
    fix: ["Type params as a Promise and await it in Server Components", "In a Client Component, unwrap it with React's use(params)", "Search the codebase for params. and searchParams. without an await"],
    code: { file: "src/app/blog/[slug]/page.tsx", body: "export default async function Page({\n  params,\n}: {\n  params: Promise<{ slug: string }>;\n}) {\n  const { slug } = await params;\n  // \u2026\n}" },
    prompt: "This is a Next.js 16 app, where params, searchParams, cookies() and headers() are async. Find every page, layout, route handler and generateMetadata that reads them synchronously, type them as Promises and await them (or use() in Client Components). List each file you change."
  },
  {
    id: "generate-static-params-export",
    name: "missing generateStaticParams() with output: export",
    where: "build error",
    looksLike: 'Error: Page "/blog/[slug]" is missing "generateStaticParams()" so it cannot be used with "output: export" config.',
    match: ['is missing "generatestaticparams()"', 'cannot be used with "output: export"', "generatestaticparams", "output: export"],
    means: "A static export has no server, so every dynamic route has to list its pages at build time.",
    causes: ["A new [slug] or [id] route in a site deployed as static files", 'generateStaticParams exists but sits in a "use client" page'],
    fix: ["Export generateStaticParams() from the page and return every slug", "If the route really needs a server (per-user data), drop output: export and deploy to a host that runs Next.js"],
    code: { file: "src/app/blog/[slug]/page.tsx", body: "export async function generateStaticParams() {\n  const posts = await getPosts();\n  return posts.map((p) => ({ slug: p.slug }));\n}" },
    prompt: "next build fails because a dynamic route has no generateStaticParams and the app uses output: export. Add generateStaticParams that returns every value for this route from the same data source the page reads."
  },
  {
    id: "next-image-host",
    name: "next/image hostname is not configured",
    where: "dev overlay",
    looksLike: 'Error: Invalid src prop (https://avatars.githubusercontent.com/u/1) on `next/image`, hostname "avatars.githubusercontent.com" is not configured under images in your `next.config.js`',
    match: ["is not configured under images in your", "next-image-unconfigured-host", "invalid src prop", "remotepatterns"],
    means: "next/image only optimizes remote images from hosts you allow. Avatars from GitHub or Google sign-in, Stripe product images and CMS images all need an entry.",
    causes: ["Showing session.user.image from an OAuth provider", "Images from a CMS, S3 bucket or Supabase Storage"],
    fix: ["Add the host to images.remotePatterns in next.config.ts", "Be specific (protocol, hostname, path) instead of allowing every host"],
    code: { file: "next.config.ts", body: 'const nextConfig = {\n  images: {\n    remotePatterns: [new URL("https://avatars.githubusercontent.com/**")],\n  },\n};' },
    prompt: "next/image rejects a remote hostname. Add a specific images.remotePatterns entry in next.config.ts for this host (protocol, hostname and a path pattern if possible). Don't allow all hosts."
  },
  {
    id: "hydration-mismatch",
    agent: true,
    quick: "no Date.now / Math.random / window during render",
    name: "Hydration failed: server HTML didn't match the client",
    where: "browser console",
    looksLike: "Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client.\n  \xB7 A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.",
    match: ["hydration failed because", "didn't match the client", "a tree hydrated but some attributes", "hydration", "text content does not match", "suppresshydrationwarning"],
    means: "React rendered the page on the server, then got different output in the browser. Something in render depends on the time, randomness, the browser or the user's locale.",
    causes: ["new Date(), Date.now() or Math.random() in render", 'if (typeof window !== "undefined") branches, or reading localStorage during render', "toLocaleString() with a different server and browser locale or time zone", "Invalid HTML nesting like <p> inside <p> or <div> inside <p>", "Browser extensions that add attributes to <html> or <body>"],
    fix: ["Move browser-only values into useEffect, or render them in a Client Component loaded with next/dynamic and ssr: false", "Format dates with an explicit timeZone, or on the server only", "Fix invalid nesting the error points at", "For extension attributes only: suppressHydrationWarning on <html> (it only applies one level deep)"],
    prompt: "React reports a hydration mismatch. Find what renders differently on the server and in the browser (dates, random values, window/localStorage checks, locale formatting, invalid HTML nesting) and fix the cause. Don't add suppressHydrationWarning except for extension attributes on <html> or <body>."
  },
  {
    id: "middleware-to-proxy",
    agent: true,
    quick: "rename middleware.ts to proxy.ts",
    name: 'The "middleware" file convention is deprecated',
    where: "build warning",
    looksLike: '\u26A0 The "middleware" file convention is deprecated. Please use "proxy" instead.\n\n  To migrate automatically, run:\n  npx @next/codemod@canary middleware-to-proxy .',
    match: ['the "middleware" file convention is deprecated', 'please use "proxy" instead', "middleware-to-proxy", "middleware.ts", "middleware"],
    means: "Next.js 16 renamed middleware.ts to proxy.ts. Agents keep creating middleware.ts because most examples predate the rename. Proxy runs on the Node.js runtime, and the runtime option isn't allowed in proxy files.",
    causes: ["An agent added auth or redirects in middleware.ts", "Code copied from Next.js 13\u201315 or Auth.js v4 examples"],
    fix: ["Run npx @next/codemod@canary middleware-to-proxy . or rename the file and the exported function to proxy", 'Remove any export const runtime = "edge" from it', "Keep matchers in export const config as before"],
    code: { file: "src/proxy.ts", body: 'import { NextResponse, type NextRequest } from "next/server";\n\nexport function proxy(request: NextRequest) {\n  return NextResponse.next();\n}\n\nexport const config = { matcher: ["/dashboard/:path*"] };' },
    prompt: "This is Next.js 16: middleware.ts is deprecated in favor of proxy.ts. Migrate it (rename the file and the exported function to proxy, keep the matcher config, remove any runtime export) and check nothing else imports the old file."
  },
  {
    id: "version-pinning",
    agent: true,
    quick: "pin next, commit the lockfile, use npm ci",
    name: "npm ci: package.json and package-lock.json are not in sync",
    where: "build error",
    looksLike: "npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.",
    match: ["can only install packages when your package.json and package-lock.json", "are in sync", "does not satisfy next@", "lock file's next@", "npm ci", "eusage", "next@latest", "lockfile", "package-lock"],
    means: "Someone (often an agent fixing something else) changed the next version in package.json without updating package-lock.json, so a clean install refuses to run. The lockfile is what pins the exact version you tested: a range like ^16.4.3 in package.json allows any later 16.x, so without a committed lockfile each install can build against a different Next.js.",
    causes: ["An agent edited the next, react or eslint-config-next version in package.json, or ran npm install next@latest, while fixing something else", `package-lock.json is in .gitignore, wasn't committed, or was deleted to "fix" an install error`, "next, eslint-config-next and react changed in different commits"],
    fix: ["See what's installed: npm ls next react react-dom", "Pin an exact version you have tested (no ^), and make it 16.4.5 or later since 16.4.5 is the Nov 3, 2026 security release: npm pkg set dependencies.next=16.4.5 devDependencies.eslint-config-next=16.4.5, run npm install to update package-lock.json, then commit both files together", "Use npm ci in CI and deploy builds so installs match the lockfile exactly", "Upgrade on purpose in its own branch: npx @next/codemod@canary upgrade latest, then run the build and tests"],
    code: { file: "terminal", body: 'npm ls next react react-dom\nnpm pkg set dependencies.next=16.4.5 devDependencies.eslint-config-next=16.4.5\nnpm install\ngit add package.json package-lock.json\ngit commit -m "Pin next to 16.4.5"\nnpm ci && npm run build' },
    prompt: "npm ci fails because package.json and package-lock.json are out of sync on next. Don't upgrade anything. Find which commit changed the next/react/eslint-config-next versions, restore the last version the app built with, pin it as an exact version (no ^), regenerate the lockfile with npm install, and confirm npm ci && npm run build pass. If that version is below 16.4.5 (the Nov 3, 2026 Next.js security release), tell me before pinning it. List every version you changed."
  },
  {
    id: "max-update-depth",
    name: "Maximum update depth exceeded",
    where: "browser console",
    looksLike: "Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.",
    match: ["maximum update depth exceeded", "too many re-renders", "calls setstate inside useeffect"],
    means: "A component keeps updating its own state in a loop, so React stops it. It's a React error, but agents cause it often when they wire up effects.",
    causes: ["setState in a useEffect with no dependency array", "An object or array created during render used as an effect dependency", "onClick={setOpen(true)} instead of onClick={() => setOpen(true)}"],
    fix: ["Give the effect a dependency array, and only list values that really change", "Memoize object or array dependencies, or depend on their primitive fields", "Pass a function to event props instead of calling it"],
    prompt: "React hit Maximum update depth exceeded. Find the effect or handler that sets state on every render, explain the loop in one sentence, and fix it with correct dependencies or by passing a function instead of calling it."
  }
];
function scoreError(e, raw) {
  const q = raw.toLowerCase();
  if (!q.trim()) return 0;
  let s = 0;
  e.match.forEach((m, i) => {
    if (q.includes(m)) s += (i === 0 ? 10 : 4) + Math.min(m.length, 30) / 10;
  });
  return s;
}

// src/lib/authjs-errors.ts
var CHECKED_ON2 = "October 27, 2026";
var CHECKED_ISO2 = "2026-10-27";
var VERSIONS2 = "next-auth 5.0.0-beta.32 \xB7 @auth/core 0.41.3 \xB7 Next.js 16.4.3";
var AUTH_ERRORS = [
  {
    id: "configuration",
    name: "error=Configuration",
    where: "browser URL",
    looksLike: "/api/auth/error?error=Configuration",
    match: ["error=configuration", "server error", "there is a problem with the server configuration", "configuration"],
    means: "This is a cover, not the real error. Auth.js only sends a few error types to the browser (AccessDenied, Verification, OAuthAccountNotLinked and a handful more). Everything else, like a missing secret or a database failure, shows up as Configuration so it can't leak details.",
    causes: ["The real error is in your server logs, on a line starting with [auth][error]", "Most often MissingSecret, UntrustedHost or an AdapterError"],
    fix: ["Open the logs where the app runs (Vercel \u2192 Deployments \u2192 Logs, or your terminal)", "Find the [auth][error] line and paste it into the box above", "Add debug: true to your NextAuth config temporarily if the line isn't there"],
    prompt: "Sign-in redirects to /api/auth/error?error=Configuration. Don't guess. Tell me where my server logs are for this host, then read the [auth][error] line and fix only that root cause."
  },
  {
    id: "missing-secret",
    quick: "set AUTH_SECRET on the host, redeploy",
    name: "MissingSecret",
    where: "server log",
    looksLike: "[auth][error] MissingSecret: Please define a `secret`. Read more at https://errors.authjs.dev#missingsecret",
    match: ["missingsecret", "please define a `secret`", "please define a secret", "auth_secret"],
    means: "Auth.js has no secret to encrypt cookies and tokens with. It reads AUTH_SECRET (or AUTH_SECRET_1, _2, _3 for rotation). next-auth v5 still falls back to the old NEXTAUTH_SECRET.",
    causes: ["AUTH_SECRET is in .env.local but not in your host's environment variables", "The variable was added after the last deploy, so the running build doesn't see it", "A typo like AUTH_SECRETS or NEXT_PUBLIC_AUTH_SECRET"],
    fix: ["Generate one: npx auth secret (or openssl rand -base64 33)", "Add AUTH_SECRET to the production environment on your host", "Redeploy so the new value is picked up", "Never prefix it with NEXT_PUBLIC_: that ships it to the browser"],
    code: { file: ".env.local", body: '# at least 32 random characters\nAUTH_SECRET="paste-the-output-of-npx-auth-secret"' },
    prompt: "Auth.js throws MissingSecret in production. Check which env vars my auth.ts reads, confirm AUTH_SECRET is set for the production environment on my host (not only in .env.local), and make sure it is never exposed with a NEXT_PUBLIC_ prefix.",
    prodOnly: true
  },
  {
    id: "untrusted-host",
    quick: "trustHost: true or AUTH_TRUST_HOST=true",
    name: "UntrustedHost",
    where: "server log",
    looksLike: "[auth][error] UntrustedHost: Host must be trusted. URL was: https://your-app.com/api/auth/session. Read more at https://errors.authjs.dev#untrustedhost",
    match: ["untrustedhost", "host must be trusted", "trusthost"],
    means: "Auth.js builds callback URLs from the request's Host header and refuses to trust it by default in production. In development (NODE_ENV not production) it trusts the host automatically, which is why this only appears after you deploy.",
    causes: ["Running next start, Docker, Railway, Fly, Render or a VPS behind a proxy", "Vercel and Cloudflare Pages are detected automatically (VERCEL / CF_PAGES env vars), most other hosts are not"],
    fix: ["Set trustHost: true in your NextAuth config, or", "Set AUTH_TRUST_HOST=true in the production environment", "Setting AUTH_URL also counts as trusting the host"],
    code: { file: "src/auth.ts", body: "export const { handlers, auth, signIn, signOut } = NextAuth({\n  trustHost: true, // needed for next start, Docker and most non-Vercel hosts\n  providers: [GitHub],\n});" },
    prompt: "Auth.js logs UntrustedHost after deploying with next start. Add trustHost: true to the NextAuth config in auth.ts (or tell me to set AUTH_TRUST_HOST=true on the host) and explain why it worked locally.",
    prodOnly: true
  },
  {
    id: "github-redirect-uri",
    quick: "a second GitHub OAuth app for prod",
    name: "GitHub: redirect_uri mismatch",
    where: "GitHub page",
    looksLike: "error=redirect_uri_mismatch \xB7 The redirect_uri is not associated with this application.",
    match: ["redirect_uri_mismatch", "redirect_uri is not associated", "the redirect_uri must match", "redirect_uri", "callback url"],
    means: "The callback URL Auth.js sent to GitHub doesn't match the one registered on your GitHub OAuth app. A GitHub OAuth app has one callback URL, so the app you made for localhost can't also serve production.",
    causes: ["Signing in on production with the localhost OAuth app's client ID", "http vs https, www vs no www, or a different port", "A preview deployment URL that changes on every deploy"],
    fix: ["Create a second GitHub OAuth app for production (github.com/settings/developers)", "Set its callback URL to https://your-domain.com/api/auth/callback/github", "Put that app's ID and secret in production as AUTH_GITHUB_ID and AUTH_GITHUB_SECRET", "For previews, Auth.js supports a stable redirect proxy via AUTH_REDIRECT_PROXY_URL"],
    code: { file: "GitHub OAuth app (production)", body: "Homepage URL:   https://your-domain.com\nCallback URL:   https://your-domain.com/api/auth/callback/github" },
    prompt: "GitHub sign-in fails in production with redirect_uri_mismatch. List the exact callback URL my app sends (base path /api/auth, provider github) for my production domain, and the env vars I need for a separate production GitHub OAuth app.",
    prodOnly: true
  },
  {
    id: "localhost-redirect",
    quick: "delete AUTH_URL / NEXTAUTH_URL in prod",
    name: "Redirected to localhost after deploy",
    where: "browser URL",
    looksLike: "https://your-app.com \u2192 sign in \u2192 http://localhost:3000/api/auth/callback/github",
    match: ["localhost:3000", "redirects to localhost", "redirected to localhost", "auth_url", "nextauth_url"],
    means: "If AUTH_URL or NEXTAUTH_URL is set, next-auth v5 rewrites the request's origin to it. A localhost value copied into production sends every user back to localhost.",
    causes: ["NEXTAUTH_URL=http://localhost:3000 copied from a v4 tutorial into the host's env vars", "AUTH_URL left over from local testing"],
    fix: ["Delete AUTH_URL and NEXTAUTH_URL from production. v5 infers the host from the request", "Only set AUTH_URL when Auth.js lives under a different base path", "Redeploy"],
    prompt: "After deploying, sign-in sends users to localhost. Find every place AUTH_URL or NEXTAUTH_URL is set or read, and tell me which ones to remove for production on Auth.js v5.",
    prodOnly: true
  },
  {
    id: "oauth-account-not-linked",
    name: "OAuthAccountNotLinked",
    where: "browser URL",
    looksLike: "/login?error=OAuthAccountNotLinked",
    match: ["oauthaccountnotlinked", "another account already exists with the same e-mail", "already associated with another user", "accountnotlinked"],
    means: "Someone already has an account with this email, created with a different sign-in method (say, a magic link), and now tries GitHub. For security, Auth.js won't attach the new provider to an existing user who isn't signed in.",
    causes: ["Same email used with email magic link first, GitHub second (or the reverse)", "Test users left in your dev database"],
    fix: ['Show a friendly message on your sign-in page: "Sign in the way you did the first time"', "Let signed-in users link extra providers from their account page", "allowDangerousEmailAccountLinking: true on a provider turns on auto-linking. Only use it if you trust that provider to verify emails"],
    code: { file: "src/app/login/page.tsx", body: 'const messages: Record<string, string> = {\n  OAuthAccountNotLinked: "That email already has an account. Sign in the way you did the first time.",\n  Verification: "That sign-in link expired or was already used. Request a new one.",\n};' },
    prompt: "Users who signed up with a magic link get OAuthAccountNotLinked when they try GitHub. Show a clear message for ?error=OAuthAccountNotLinked on my sign-in page. Don't enable allowDangerousEmailAccountLinking unless I confirm."
  },
  {
    id: "verification",
    name: "error=Verification",
    where: "browser URL",
    looksLike: "/api/auth/error?error=Verification",
    match: ["error=verification", "verification", "link is no longer valid", "token has expired"],
    means: "The magic-link token wasn't found or has expired. Each link works once, and the email provider's default lifetime is 24 hours.",
    causes: ["The link was clicked twice, or a newer link replaced it", "The link is older than 24 hours", "The verification token was written to a different database than the one the app reads now"],
    fix: ["Ask the user to request a new link, and say so on the error page", "Make sure dev and prod don't share or swap DATABASE_URL", "Raise maxAge on the email provider only if you have a reason to"],
    prompt: "Magic-link sign-in lands on error=Verification. Check my email provider config, the VerificationToken table and DATABASE_URL per environment, and add a 'request a new link' message for this error."
  },
  {
    id: "missing-adapter",
    name: "MissingAdapter",
    where: "server log",
    looksLike: "[auth][error] MissingAdapter: Email login requires an adapter. Read more at https://errors.authjs.dev#missingadapter",
    match: ["missingadapter", "requires an adapter", "email login requires an adapter", "database session requires an adapter"],
    means: 'Magic links (Email / Nodemailer / Resend providers) and session: { strategy: "database" } both need a database adapter to store tokens and sessions.',
    causes: ["Added the Nodemailer or Resend provider without an adapter", 'Set strategy: "database" without an adapter', "Imported the adapter but passed it in only one of two config files"],
    fix: ["Install @auth/prisma-adapter (v5 adapters live under @auth/, not @next-auth/)", "Pass adapter: PrismaAdapter(db) to NextAuth", "Add the User, Account, Session and VerificationToken models and run a migration"],
    code: { file: "src/auth.ts", body: 'import { PrismaAdapter } from "@auth/prisma-adapter";\nimport { db } from "@/lib/db";\n\nexport const { handlers, auth, signIn, signOut } = NextAuth({\n  adapter: PrismaAdapter(db),\n  session: { strategy: "database" },\n  providers,\n});' },
    prompt: "Auth.js says MissingAdapter. Wire @auth/prisma-adapter into auth.ts, check my Prisma schema has the User, Account, Session and VerificationToken models from the Auth.js Prisma adapter docs, and give me the migration command."
  },
  {
    id: "adapter-error",
    quick: "npx prisma migrate deploy on Postgres",
    name: "AdapterError / table does not exist",
    where: "server log",
    looksLike: "[auth][error] AdapterError \u2026 The table `main.User` does not exist in the current database.",
    match: ["adaptererror", "does not exist in the current database", "p2021", "adapter_", "prisma"],
    means: "One of the adapter's database calls failed. The cause line under it says why, and with Prisma it's usually a missing table or an unreachable database.",
    causes: ["Migrations never ran against the production database", "DATABASE_URL points to SQLite on a serverless host, where the file doesn't persist", "Schema models renamed so they no longer match what the adapter expects"],
    fix: ["Run npx prisma migrate deploy against production (or prisma db push while prototyping)", "Use Postgres in production. SQLite files don't survive serverless deploys", "Set debug: true once to see which adapter_ method failed"],
    prompt: "Auth.js logs AdapterError with a Prisma 'table does not exist' cause in production. Check DATABASE_URL and the Prisma provider for prod, then give me the exact migrate command to run and where to run it.",
    prodOnly: true
  },
  {
    id: "invalid-check",
    name: "InvalidCheck (PKCE / state)",
    where: "server log",
    looksLike: "[auth][error] InvalidCheck: pkceCodeVerifier value could not be parsed. Read more at https://errors.authjs.dev#invalidcheck",
    match: ["invalidcheck", "pkcecodeverifier", "state value could not be parsed", "could not be parsed", "nonce"],
    means: "Auth.js sets a short-lived cookie when sign-in starts and checks it when the provider sends the user back. The cookie was missing on the way back.",
    causes: ["Starting on 127.0.0.1 and coming back to localhost (or www vs no www): different cookie jars", "The callback lands on a different domain than the one sign-in started on", "Cookies blocked in the browser, or a custom cookies config"],
    fix: ["Use one exact origin everywhere: the address bar, the OAuth app and any AUTH_URL", "Redirect www to the apex domain (or the reverse) at the host", "Remove custom cookies options unless you need them"],
    prompt: "GitHub sign-in fails with InvalidCheck (pkceCodeVerifier). Check whether sign-in starts and returns on the same origin (localhost vs 127.0.0.1, www vs apex), and whether my config overrides cookies."
  },
  {
    id: "jwt-session-error",
    name: "JWTSessionError",
    where: "server log",
    looksLike: "[auth][error] JWTSessionError: Read more at https://errors.authjs.dev#jwtsessionerror  [auth][cause]: Error: no matching decryption secret",
    match: ["jwtsessionerror", "no matching decryption secret", "jwe", "decryption"],
    means: `With strategy "jwt", Auth.js couldn't decrypt the session cookie. The cookie was encrypted with a different secret, so it's destroyed and the user is signed out.`,
    causes: ["AUTH_SECRET changed (or differs between preview and production)", "An old cookie from another app on localhost:3000"],
    fix: ["For one user: clear cookies for the site and sign in again", "To rotate without signing everyone out, set the new secret as AUTH_SECRET and keep the old one as AUTH_SECRET_1 for a while", "Use the same secret on every deployment that shares the domain"],
    prompt: "Auth.js logs JWTSessionError: no matching decryption secret. Check whether AUTH_SECRET differs between environments and set up AUTH_SECRET_1 rotation if I changed it on purpose."
  },
  {
    id: "session-token-error",
    name: "SessionTokenError",
    where: "server log",
    looksLike: "[auth][error] SessionTokenError: Read more at https://errors.authjs.dev#sessiontokenerror",
    match: ["sessiontokenerror"],
    means: `With strategy "database", Auth.js couldn't read the session from the database. The adapter is misconfigured or the database can't be reached.`,
    causes: ["Database down or DATABASE_URL wrong in this environment", "Connection limit hit on serverless Postgres without pooling"],
    fix: ["Check the cause line and your database dashboard", "Use your provider's pooled connection string on serverless", "Reuse one Prisma client (a global singleton in dev)"],
    prompt: "Auth.js logs SessionTokenError with database sessions. Check DATABASE_URL for this environment, whether I use a pooled connection on serverless, and that my Prisma client is a singleton."
  },
  {
    id: "access-denied",
    name: "AccessDenied",
    where: "browser URL",
    looksLike: "/api/auth/error?error=AccessDenied",
    match: ["accessdenied", "access_denied", "error=accessdenied", "the user has denied"],
    means: "Your signIn callback returned false (or threw), or the user clicked Cancel on the provider's consent screen.",
    causes: ["An allow-list in callbacks.signIn that doesn't include this email", "The user declined on GitHub"],
    fix: ["Log the inputs in callbacks.signIn to see why it returned false", "Return a redirect path string from signIn instead of false to send blocked users somewhere useful"],
    prompt: "Sign-in ends at error=AccessDenied. Show me my callbacks.signIn logic, log why it returns false for this user, and suggest returning a friendly redirect instead."
  },
  {
    id: "missing-csrf",
    name: "MissingCSRF",
    where: "server log",
    looksLike: "[auth][error] MissingCSRF: CSRF token was missing during an action signin. Read more at https://errors.authjs.dev#missingcsrf",
    match: ["missingcsrf", "csrf token was missing", "csrf"],
    means: "A sign-in or sign-out POST arrived without Auth.js's CSRF cookie and token. Often it's a hand-rolled fetch to /api/auth/signin instead of the provided helpers.",
    causes: ["fetch('/api/auth/signin/\u2026', { method: 'POST' }) written by hand", "A form posting to the Auth.js endpoint from another origin"],
    fix: ["Use signIn() from your auth.ts in a Server Action, or signIn from next-auth/react in a Client Component", "Don't call the /api/auth endpoints directly"],
    code: { file: "src/app/login/page.tsx", body: 'import { signIn } from "@/auth";\n\n<form action={async () => { "use server"; await signIn("github", { redirectTo: "/dashboard" }); }}>\n  <button>Sign in with GitHub</button>\n</form>' },
    prompt: "Auth.js logs MissingCSRF. Find any hand-written fetch or form that posts to /api/auth/* and replace it with signIn() from auth.ts in a Server Action."
  },
  {
    id: "v4-imports",
    name: "v4 code in a v5 app (getServerSession, authOptions)",
    where: "build / TypeScript",
    looksLike: `Module '"next-auth"' has no exported member 'NextAuthOptions'. \xB7 getServerSession(authOptions)`,
    match: ["getserversession", "authoptions", "nextauthoptions", "next-auth/next", "next-auth/middleware", "@next-auth/prisma-adapter", "withauth", "gettoken"],
    means: "Your AI agent wrote NextAuth v4 code. A lot of tutorials and training data are from v4, so agents mix the two APIs unless you tell them which version you use.",
    causes: ["getServerSession(authOptions) and next-auth/next imports", "NextAuthOptions (renamed NextAuthConfig)", 'export { default } from "next-auth/middleware"', "@next-auth/prisma-adapter (now @auth/prisma-adapter)"],
    fix: ["Call auth() from your auth.ts everywhere on the server", "Export auth as proxy in proxy.ts (Next.js 16 renamed middleware.ts)", "Add a rule telling your agent the project uses Auth.js v5 and to check package.json before writing auth code"],
    code: { file: "src/app/dashboard/page.tsx", body: '- import { getServerSession } from "next-auth/next"\n- const session = await getServerSession(authOptions)\n+ import { auth } from "@/auth"\n+ const session = await auth()' },
    prompt: "This project uses Auth.js v5 (next-auth@5). Search for getServerSession, authOptions, NextAuthOptions, next-auth/next, next-auth/middleware, getToken and @next-auth/ imports and migrate each one to the v5 auth() API. List every file you change."
  }
];
function scoreError2(e, raw) {
  const q = raw.toLowerCase();
  if (!q.trim()) return 0;
  let s = 0;
  e.match.forEach((m, i) => {
    if (q.includes(m)) s += (i === 0 ? 10 : 4) + Math.min(m.length, 30) / 10;
  });
  const param = /[?&]error=([a-z]+)/i.exec(raw)?.[1]?.toLowerCase();
  if (param && (e.id.replace(/-/g, "") === param || e.name.toLowerCase().replace(/[^a-z]/g, "").startsWith(param) || e.match.includes(`error=${param}`))) s += 20;
  return s;
}

// src/lib/prisma-errors.ts
var CHECKED_ON3 = "October 25, 2026";
var CHECKED_ISO3 = "2026-10-25";
var VERSIONS3 = "Prisma ORM 6.19 \xB7 Next.js 16";
var PRISMA_ERRORS = [
  {
    id: "did-not-initialize",
    agent: true,
    quick: "run prisma generate (and add it to postinstall)",
    name: "@prisma/client did not initialize yet",
    where: "runtime error",
    looksLike: 'Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.',
    match: ["@prisma/client did not initialize yet", "did not initialize yet", 'please run "prisma generate"', "prisma generate"],
    means: "@prisma/client is only a shell until prisma generate writes the real client for your schema. The code imported it before that ever happened on this machine or in this build.",
    causes: ["The agent ran npm install prisma @prisma/client but never prisma generate", "A fresh clone or CI build where nothing runs prisma generate", "node_modules was cached from a build that had no schema yet"],
    fix: ["Run npx prisma generate once locally", 'Add "postinstall": "prisma generate" to package.json so every install regenerates', "Make the build script prisma generate && next build"],
    snippet: { file: "package.json", body: '"scripts": {\n  "build": "prisma generate && next build",\n  "postinstall": "prisma generate"\n}' },
    prompt: `Prisma says @prisma/client did not initialize yet. Run prisma generate, then make it permanent: add "postinstall": "prisma generate" and change the build script to "prisma generate && next build" in package.json. Don't change the schema.`
  },
  {
    id: "stale-client-types",
    agent: true,
    quick: "run prisma generate after every schema change",
    name: "Property 'x' does not exist on type 'PrismaClient'",
    where: "type error",
    looksLike: "Type error: Property 'invoice' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'.",
    match: ["does not exist on type 'prismaclient", 'does not exist on type "prismaclient', "prismaclient<prismaclientoptions", "defaultargs>'"],
    means: "The model or field exists in schema.prisma but not in the generated client TypeScript sees. The client is generated code: it only changes when prisma generate runs.",
    causes: ["The agent added a model to schema.prisma and went straight to writing queries", "The model name is singular in the schema (model Invoice) but the code uses db.invoices", "The editor's TypeScript server still has the old types cached"],
    fix: ["Run npx prisma generate (prisma db push and prisma migrate dev also run it)", "Use the lowercase model name: model Invoice becomes db.invoice", "Restart the TypeScript server in your editor if the error stays after generating"],
    prompt: "TypeScript says a model doesn't exist on PrismaClient. Check prisma/schema.prisma for the model and its exact name, run prisma generate (or prisma db push for local dev), and fix any code that uses a plural or misspelled model name. Don't cast db to any."
  },
  {
    id: "vercel-outdated-client",
    agent: true,
    quick: "prisma generate in the build script",
    name: "Prisma has detected that this project was built on Vercel",
    where: "deploy error",
    looksLike: "Prisma has detected that this project was built on Vercel, which caches dependencies. This leads to an outdated Prisma Client because Prisma's auto-generation isn't triggered. To fix this, make sure to run the `prisma generate` command during the build process.",
    match: ["prisma has detected that this project was built on", "which caches dependencies", "outdated prisma client", "auto-generation isn't triggered"],
    means: "Vercel (and Netlify CI) reuse node_modules between builds, so the install step that would normally regenerate the client is skipped. Your deploy runs a client generated for an older schema, or none at all.",
    causes: ["package.json has no postinstall or build step that runs prisma generate", 'The agent removed prisma generate from the build script while "cleaning up"'],
    fix: ["Set the build script to prisma generate && next build", 'Or add "postinstall": "prisma generate"', "Redeploy (no need to clear the cache once the script runs generate)"],
    snippet: { file: "package.json", body: '"scripts": {\n  "build": "prisma generate && next build",\n  "postinstall": "prisma generate"\n}' },
    prompt: 'The Vercel build fails because Prisma Client is outdated (Vercel caches dependencies). Update package.json so the build script is "prisma generate && next build" and add "postinstall": "prisma generate". Show me the diff.'
  },
  {
    id: "browser-bundle",
    agent: true,
    quick: "query in a Server Component, pass plain data down",
    name: "PrismaClient is unable to run in this browser environment",
    where: "browser console",
    looksLike: "Error: PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `\u2026`).\nIf this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report",
    match: ["is unable to run in this browser environment", "has been bundled for the browser", "unable to run in this browser"],
    means: "Prisma Client ended up in JavaScript that runs in the browser. It can only run on the server: it needs your database URL and a server-side engine.",
    causes: ['A "use client" component imports db from lib/db.ts', "A shared helper file imports Prisma and is also used by a Client Component", 'The agent fixed a hook error by adding "use client" to a page that queries the database'],
    fix: ["Do the query in a Server Component, Server Action or route handler, and pass plain data to the Client Component as props", 'Add import "server-only" at the top of lib/db.ts, so any client import fails at build time with a clear message', "Split helpers: keep database code in files only the server imports"],
    snippet: { file: "src/lib/db.ts", body: 'import "server-only";\nimport { PrismaClient } from "@prisma/client";\n\nconst globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };\nexport const db = globalForPrisma.prisma ?? new PrismaClient();\nif (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;' },
    prompt: 'Prisma Client is being bundled into browser code. Find the "use client" file (or a helper it imports) that imports db or @prisma/client, move the query into a Server Component or Server Action, and pass plain serializable data down as props. Add import "server-only" to lib/db.ts.'
  },
  {
    id: "edge-runtime",
    agent: true,
    quick: 'remove runtime = "edge"',
    name: "PrismaClient is not configured to run in Edge Runtime",
    where: "runtime error",
    looksLike: "Error: PrismaClient is not configured to run in Edge Runtime (Vercel Edge Functions, Vercel Edge Middleware, Next.js (Pages Router) Edge API Routes, Next.js (App Router) Edge Route Handlers or Next.js Middleware). In order to run Prisma Client on edge runtime, either:\n- Use Prisma Accelerate: https://pris.ly/d/accelerate\n- Use Driver Adapters: https://pris.ly/d/driver-adapters",
    match: ["is not configured to run in", "in order to run prisma client on edge runtime", "edge runtime (vercel edge functions", "cloudflare workers. in order", "use driver adapters"],
    means: "The default Prisma 6 client needs Node.js. Code that imports it is running on the Edge runtime or Cloudflare Workers, where it can't open a normal database connection.",
    causes: ['export const runtime = "edge" on a route or page that queries the database', "An old middleware.ts (Edge) that calls auth() with a Prisma adapter", "Deploying a Node.js Next.js app to Cloudflare Workers without a driver adapter"],
    fix: ['Delete export const runtime = "edge": the Node.js runtime is the default and runs Prisma fine', "On Next.js 16, rename middleware.ts to proxy.ts: proxy runs on Node.js", "If you really need the edge or Workers, use a driver adapter (Neon, PlanetScale, D1) or Prisma Accelerate"],
    prompt: `Prisma Client fails on the Edge runtime. Find every export const runtime = "edge" in files that import db (directly or through auth), remove it so the route uses the default Node.js runtime, and on Next.js 16 make sure middleware.ts is migrated to proxy.ts. Don't add Prisma Accelerate unless I ask.`
  },
  {
    id: "env-not-found",
    agent: true,
    quick: "DATABASE_URL in .env (not only .env.local)",
    name: "Environment variable not found: DATABASE_URL",
    where: "runtime error",
    looksLike: 'error: Environment variable not found: DATABASE_URL.\n  -->  schema.prisma:8\n   |\n 7 |   provider = "postgresql"\n 8 |   url      = env("DATABASE_URL")',
    match: ["environment variable not found: database_url", "environment variable not found", "missing url environment variable", 'env("database_url")'],
    means: `schema.prisma reads the connection string from env("DATABASE_URL") and it isn't set where this command or server is running.`,
    causes: ["The agent put DATABASE_URL in .env.local: Next.js reads it, but the Prisma 6 CLI only loads .env", "It's set locally but not in the Vercel (or other host) project settings", "It's set for Production but not Preview deployments"],
    fix: ["For local dev, put DATABASE_URL in .env (keep it in .gitignore)", "Add it in your host's environment variables for every environment that builds or runs the app, then redeploy", 'Check the spelling: the name in env("\u2026") must match exactly'],
    prompt: "Prisma can't find DATABASE_URL. Check which env files exist: the Prisma 6 CLI only reads .env, not .env.local. Put DATABASE_URL in .env for local dev, make sure .env is gitignored, and list the hosting environment variables I still need to set. Don't print the secret value."
  },
  {
    id: "url-protocol",
    name: "The URL must start with the protocol postgresql://",
    where: "runtime error",
    looksLike: "error: Error validating datasource `db`: the URL must start with the protocol `postgresql://` or `postgres://`.\n  -->  schema.prisma:8",
    match: ["the url must start with the protocol", "error validating datasource", "must start with the protocol `postgresql://`", "must start with the protocol `file:`"],
    means: "DATABASE_URL is set, but it doesn't match the provider in schema.prisma. Prisma checks the protocol before connecting.",
    causes: ['provider = "postgresql" but DATABASE_URL is still file:./dev.db (or the other way round)', "The Supabase or Neon project URL (https://\u2026) pasted instead of the database connection string", "Quotes or a space copied into the value in the hosting dashboard"],
    fix: ["Make the provider and the URL agree: postgresql:// for Postgres, file: for SQLite", "Copy the connection string from the database's Connect panel, not the API URL", "Paste the raw value in the dashboard, without quotes"],
    prompt: "Prisma says the datasource URL has the wrong protocol. Compare the provider in prisma/schema.prisma with the protocol of DATABASE_URL (don't print the full value, just the scheme) and tell me which one to change. If I'm moving from SQLite to Postgres, update the provider and remind me to run prisma db push or migrate."
  },
  {
    id: "p1001",
    code: "P1001",
    name: "P1001: Can't reach database server",
    where: "runtime error",
    looksLike: "PrismaClientInitializationError: Can't reach database server at `db.example.supabase.co:5432`\n\nPlease make sure your database server is running at `db.example.supabase.co:5432`.",
    match: ["can't reach database server", "p1001", "please make sure your database server is running", "can't reach database"],
    means: "Prisma couldn't open a network connection to the host and port in DATABASE_URL. Nothing about your schema or query yet: it's the network, the host or the database itself.",
    causes: ["The local database (Docker, Postgres.app) isn't running", "A paused free-tier database (Supabase and Neon pause or suspend idle projects)", "The direct host is IPv6-only and your network or host has no IPv6: use the provider's pooler host", "Wrong host or port, or a firewall / IP allow list blocking the server"],
    fix: ["Start or unpause the database, then retry", "Copy a fresh connection string from the provider dashboard (for Supabase from a serverless host, use the pooler connection string)", "Check the host's IP allow list if your provider has one"],
    prompt: "Prisma throws P1001 Can't reach database server. Without printing secrets, check the host and port in DATABASE_URL, tell me whether it's a direct or pooled connection, and list the likely causes for my provider (paused project, IPv6-only direct host, firewall). Don't change the schema."
  },
  {
    id: "p1000",
    code: "P1000",
    name: "P1000: Authentication failed against database server",
    where: "runtime error",
    looksLike: "Authentication failed against database server, the provided database credentials for `postgres` are not valid.\n\nPlease make sure to provide valid database credentials for the database server at the configured address.",
    match: ["authentication failed against database server", "p1000", "credentials for `", "are not valid"],
    means: "The server was reached but rejected the username or password in DATABASE_URL.",
    causes: ["A password with @, #, / or : that isn't URL-encoded, so the URL is parsed wrong", "The database password was reset and the env var still has the old one", "Pooler connection strings that need the user as postgres.<project-ref>, not just postgres"],
    fix: ["URL-encode special characters in the password (@ becomes %40, # becomes %23)", "Copy the full connection string again from the provider and update it everywhere", "Redeploy after changing environment variables"],
    prompt: "Prisma throws P1000 authentication failed. Without printing the password, check whether DATABASE_URL's password contains characters that need URL-encoding and whether the username format matches my provider's pooler. Tell me exactly what to change."
  },
  {
    id: "p2021",
    code: "P2021",
    agent: true,
    quick: "prisma migrate deploy / db push on that database",
    name: "P2021: The table does not exist in the current database",
    where: "query error",
    looksLike: "PrismaClientKnownRequestError:\nInvalid `db.invoice.findMany()` invocation:\n\nThe table `public.Invoice` does not exist in the current database.",
    match: ["does not exist in the current database", "p2021", "the table `", 'relation "', "does not exist"],
    means: "The client knows about the model, but the database it's connected to was never given that table. The schema changed and nobody pushed or migrated this database.",
    causes: ["The agent added a model and ran prisma generate, but not db push or migrate", "Production points at a different database than the one you migrated locally", "Migrations exist but the deploy never runs prisma migrate deploy"],
    fix: ["Local prototype: npx prisma db push", "With migrations: npx prisma migrate dev locally, then npx prisma migrate deploy against production", "Check DATABASE_URL points at the database you think it does"],
    prompt: "Prisma throws P2021: the table doesn't exist. Check whether this project uses migrations (prisma/migrations) or db push, then give me the exact command to sync the schema to the database DATABASE_URL points at, and add migrate deploy to the deploy step if migrations are used."
  },
  {
    id: "p2002",
    code: "P2002",
    name: "P2002: Unique constraint failed",
    where: "query error",
    looksLike: "PrismaClientKnownRequestError:\nInvalid `db.user.create()` invocation:\n\nUnique constraint failed on the fields: (`email`)",
    match: ["unique constraint failed", "p2002", "unique constraint"],
    means: "You tried to create or update a row with a value that must be unique (an email, a Stripe customer id, a slug) and another row already has it.",
    causes: ["Sign-up or seed code that always calls create, even when the record exists", "A Stripe webhook delivered twice, each delivery creating the same row", "Two requests racing to create the same record"],
    fix: ['Use upsert when "create or update" is what you mean', 'Catch the error by code: error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002", and show a friendly message', "For webhooks, store the event id with a unique constraint and skip duplicates"],
    snippet: { file: "src/lib/customers.ts", body: "await db.user.upsert({\n  where: { email },\n  update: { stripeCustomerId },\n  create: { email, stripeCustomerId },\n});" },
    prompt: "Prisma throws P2002 Unique constraint failed. Find the create or update that hits it, decide whether it should be an upsert, and otherwise catch Prisma.PrismaClientKnownRequestError with code P2002 and return a clear error to the user. Don't remove the @unique from the schema."
  },
  {
    id: "p2025",
    code: "P2025",
    name: "P2025: Record required but not found",
    where: "query error",
    looksLike: "PrismaClientKnownRequestError:\nInvalid `db.user.update()` invocation:\n\nAn operation failed because it depends on one or more records that were required but not found. No record was found for an update.",
    match: ["required but not found", "p2025", "no record was found for an update", "no record was found for a query", "no record was found for a delete", "record to update not found"],
    means: "update, delete, connect or a findUniqueOrThrow / findFirstOrThrow call needed a row that wasn't there.",
    causes: ["Updating by an id or email that doesn't exist (or belongs to another user's filter)", "Deleting something that was already deleted, often a double-clicked button or a retried webhook", "connect: { id } pointing at a missing related record"],
    fix: ["If missing is normal, use updateMany / deleteMany (they return a count instead of throwing) or findUnique and check for null", "Otherwise catch code P2025 and return a 404", "Check the where clause uses a field that's really unique for this user"],
    prompt: "Prisma throws P2025 record not found. Find the update, delete, connect or *OrThrow call, and decide whether a missing record is expected. If it is, switch to findUnique + null check or updateMany/deleteMany; if not, catch P2025 and return a 404. Show me the diff."
  },
  {
    id: "p2003",
    code: "P2003",
    name: "P2003: Foreign key constraint violated",
    where: "query error",
    looksLike: "PrismaClientKnownRequestError:\nInvalid `db.post.create()` invocation:\n\nForeign key constraint violated on the foreign key",
    match: ["foreign key constraint violated", "p2003", "foreign key constraint failed", "foreign key"],
    means: "A row points at a related row that doesn't exist (on create or update), or you deleted a row that other rows still point at.",
    causes: ["Creating a record with a userId from a stale session or a hard-coded id", "Deleting a user that still has posts, subscriptions or accounts", "Seed scripts that insert children before parents"],
    fix: ["Use connect with an id you just read from the database (or the signed-in session)", "Add onDelete: Cascade to the relation if children should go with the parent, then push or migrate", "Insert parents before children in seeds, or wrap both in db.$transaction"],
    prompt: "Prisma throws P2003 foreign key constraint violated. Find which relation it is, check whether the parent record exists, and either fix the id being used or add onDelete: Cascade (or SetNull) to the relation if that's the intended behavior. Tell me before changing the schema."
  },
  {
    id: "unknown-argument",
    agent: true,
    quick: "use field names from schema.prisma, not guesses",
    name: "PrismaClientValidationError: Unknown argument",
    where: "query error",
    looksLike: 'PrismaClientValidationError:\nInvalid `db.user.findMany()` invocation:\n\n{\n  where: {\n    emial: "a@b.co",\n    ~~~~~\n  }\n}\n\nUnknown argument `emial`. Did you mean `email`? Available options are marked with ?.',
    match: ["unknown argument", "prismaclientvalidationerror", "available options are marked with ?", "unknown field", "did you mean `"],
    means: "The query uses a field or option the generated client doesn't know. Prisma checks every query against your schema before sending it.",
    causes: ["The agent guessed a field name (userId vs ownerId, createdAt vs created_at)", "The field exists in schema.prisma but the client wasn't regenerated", "A relation filter written like a scalar: where: { user: id } instead of where: { userId: id }"],
    fix: ['Use the name Prisma suggests after "Did you mean"', "If the field is new, run npx prisma generate", "Let TypeScript check queries: don't type db or the query args as any"],
    prompt: "Prisma throws a PrismaClientValidationError (Unknown argument). Read prisma/schema.prisma, then fix the query to use the real field names. If the field was just added, run prisma generate. Don't cast to any to silence it."
  },
  {
    id: "argument-missing",
    name: "PrismaClientValidationError: Argument is missing",
    where: "query error",
    looksLike: 'PrismaClientValidationError:\nInvalid `db.post.create()` invocation:\n\n{\n  data: {\n    title: "Hello",\n+   user: {\n+     create: UserCreateWithoutPostsInput | UserUncheckedCreateWithoutPostsInput,\n+     connectOrCreate: UserCreateOrConnectWithoutPostsInput,\n+     connect: UserWhereUniqueInput\n+   }\n  }\n}\n\nArgument `user` is missing.',
    match: ["is missing.", "argument `", "createwithout", "connectorcreate"],
    means: "A required field or relation wasn't provided. The lines marked with + show what Prisma expected.",
    causes: ["Creating a child record without its owner (no userId and no user: { connect })", "A new required field added to the schema, while existing create calls weren't updated"],
    fix: ["Pass the relation: user: { connect: { id: session.user.id } } (or userId directly)", "When adding a required field to an existing model, give it a @default or make it optional first"],
    prompt: "Prisma says an argument is missing on create. Read the marked lines in the error, then pass the missing field or relation (for user-owned records, connect the signed-in user's id from the session). If a new required field caused it, suggest a @default."
  },
  {
    id: "p2024-pool-timeout",
    code: "P2024",
    agent: true,
    quick: "one PrismaClient singleton + a pooled URL",
    name: "P2024: Timed out fetching a new connection from the connection pool",
    where: "runtime error",
    looksLike: "PrismaClientKnownRequestError: Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 5)",
    match: ["timed out fetching a new connection from the connection pool", "p2024", "connection pool timeout", "too many clients already", "too many connections", "remaining connection slots are reserved"],
    means: "Every connection Prisma may open is busy, or the database refused more. In Next.js this is almost always too many PrismaClient instances, or serverless functions each holding their own pool.",
    causes: ["new PrismaClient() in many files, or inside a request handler", "next dev hot reload creating a fresh client on every change (no globalThis singleton)", "Serverless functions connecting straight to Postgres instead of through a pooler"],
    fix: ["Create PrismaClient once in lib/db.ts with the globalThis pattern and import db everywhere", "On serverless, use the provider's pooled connection string (Supabase port 6543 with ?pgbouncer=true, or Neon's -pooler host)", "Use a direct (non-pooled) URL as directUrl in schema.prisma, for migrations"],
    snippet: { file: "prisma/schema.prisma", body: 'datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL") // pooled\n  directUrl = env("DIRECT_URL")   // direct, used by migrate\n}' },
    prompt: "Prisma throws P2024 (connection pool timeout). Search the codebase for every new PrismaClient(), replace them with one globalThis singleton in lib/db.ts, and tell me whether DATABASE_URL is a pooled connection. If it isn't, show me the schema.prisma change for url + directUrl."
  },
  {
    id: "drift-detected",
    agent: true,
    quick: "pick db push or migrate, not both",
    name: "Drift detected: database schema is not in sync with migration history",
    where: "prisma migrate",
    looksLike: 'Drift detected: Your database schema is not in sync with your migration history.\n\nWe need to reset the "public" schema at "localhost:5432"\n\nYou may use prisma migrate reset to drop the development database.\nAll data will be lost.',
    match: ["drift detected", "not in sync with your migration history", "we need to reset the", "prisma migrate reset", "all data will be lost"],
    means: "prisma migrate dev compared the database to the migrations folder and they disagree: something changed the database outside a migration.",
    causes: ["The agent ran prisma db push on a database that also uses migrate", "Someone edited a table by hand in the provider's dashboard", "A migration file was edited or deleted after it was applied"],
    fix: ["On a dev database with throwaway data, let migrate reset it", "Never answer yes on a database with real data: back it up, then create a migration for the difference (prisma migrate diff) or baseline", "Pick one workflow per database: db push for prototypes, migrate for anything in production"],
    prompt: "prisma migrate dev reports drift and wants to reset the database. Don't confirm the reset. Tell me what changed (compare with prisma migrate diff), whether this database has real data, and the safe way to get back in sync. Use migrations only from now on."
  },
  {
    id: "p3005-not-empty",
    code: "P3005",
    name: "P3005: The database schema is not empty",
    where: "prisma migrate",
    looksLike: "Error: P3005\n\nThe database schema is not empty. Read more about how to baseline an existing production database: https://pris.ly/d/migrate-baseline",
    match: ["the database schema is not empty", "p3005", "migrate-baseline", "baseline an existing"],
    means: "prisma migrate deploy found tables but no migration history, usually because the database was created with db push. It won't guess which migrations are already applied.",
    causes: ["The project started with prisma db push and later switched to migrations", "Tables created by hand or by another tool"],
    fix: ["Create a baseline migration from the current schema", "Mark it as applied with npx prisma migrate resolve --applied <migration_name>", "Run npx prisma migrate deploy for later migrations"],
    prompt: "prisma migrate deploy fails with P3005 (schema not empty). Walk me through baselining: generate an initial migration that matches the current database, mark it applied with prisma migrate resolve --applied, and confirm with migrate status. Don't drop or reset anything."
  },
  {
    id: "p3009-failed-migration",
    code: "P3009",
    name: "P3009: migrate found failed migrations",
    where: "prisma migrate",
    looksLike: "Error: P3009\n\nmigrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\nThe `20261025_add_invoices` migration started at 2026-10-25 14:02:11 UTC failed with the following logs: \u2026",
    match: ["migrate found failed migrations", "p3009", "new migrations will not be applied", "migrate-resolve"],
    means: "A previous migrate deploy failed halfway, and Prisma blocks every later migration until you say what happened to that one.",
    causes: ["A migration that adds a required column to a table that already has rows", "A unique index on a column with duplicate values", "A timeout or lost connection during deploy"],
    fix: ["Read the failed migration's error and fix the data or the SQL", "If the changes were rolled back: npx prisma migrate resolve --rolled-back <name>, then deploy again", "If you applied them by hand: npx prisma migrate resolve --applied <name>"],
    prompt: "prisma migrate deploy fails with P3009. Find the failed migration in the error, explain why it failed, and tell me whether to resolve it as --rolled-back or --applied. Fix the migration (for example a default for a new required column) before redeploying."
  },
  {
    id: "query-engine-not-found",
    name: "Prisma Client could not locate the Query Engine",
    where: "deploy error",
    looksLike: 'PrismaClientInitializationError: Prisma Client could not locate the Query Engine for runtime "rhel-openssl-3.0.x".\n\nThis happened because Prisma Client was generated for "darwin-arm64", but the actual deployment required "rhel-openssl-3.0.x".',
    match: ["could not locate the query engine", "query engine for runtime", "binarytargets", "libquery_engine", "rhel-openssl", "linux-musl"],
    means: "The client was generated on one OS (your Mac, Windows or a different Linux) and deployed to another, so the native engine file for the server isn't there.",
    causes: ["The generated client or node_modules was committed or copied from your laptop", "A Docker image on Alpine (linux-musl) while the client was generated on Debian", "A monorepo or custom output path the bundler doesn't copy"],
    fix: ["Run prisma generate during the build on the target machine, not locally", "Don't commit node_modules or the generated client", "If you must generate elsewhere, add the target to binaryTargets in the generator block"],
    snippet: { file: "prisma/schema.prisma", body: 'generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "rhel-openssl-3.0.x"]\n}' },
    prompt: "Prisma can't find the query engine for the deployment runtime. Check whether the generated client or node_modules is committed, make sure prisma generate runs in the build on the server, and only if needed add the runtime from the error to binaryTargets."
  }
];
function scoreError3(e, raw) {
  const q = raw.toLowerCase();
  if (!q.trim()) return 0;
  let s = 0;
  if (e.code && new RegExp(`\\b${e.code.toLowerCase()}\\b`).test(q)) s += 12;
  e.match.forEach((m, i) => {
    if (q.includes(m)) s += (i === 0 ? 10 : 4) + Math.min(m.length, 30) / 10;
  });
  return s;
}

// src/lib/stripe-webhook-errors.ts
var CHECKED_ON4 = "October 26, 2026";
var CHECKED_ISO4 = "2026-10-26";
var VERSIONS4 = "stripe-node 23.0.0 \xB7 Next.js 16.4.3 App Router";
var ROUTE = `// src/app/api/stripe/webhook/route.ts
import Stripe from "stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const body = await req.text(); // raw body: never req.json()
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(\`Invalid signature: \${(err as Error).message}\`, { status: 400 });
  }
  // ...handle event.type...
  return Response.json({ received: true });
}`;
var HOOK_ERRORS = [
  {
    id: "no-signatures-found",
    quick: "verify the raw req.text() body",
    name: "No signatures found matching the expected signature",
    where: "server log",
    looksLike: "StripeSignatureVerificationError: No signatures found matching the expected signature for payload. Are you passing the raw request body you received from Stripe?",
    match: ["no signatures found matching", "stripesignatureverificationerror", "are you passing the raw request body", "expected signature for payload", "signature verification"],
    means: "The signature is computed over the exact bytes Stripe sent. If your code parses the body as JSON and stringifies it again, or anything changes whitespace or encoding, the HMAC no longer matches. If the body is untouched, the secret is wrong (see the next entry).",
    causes: ["Calling req.json() and then JSON.stringify() before constructEvent", "A wrapper, logger or middleware that reads and re-serialises the body", "The right body but the wrong whsec_ secret"],
    fix: ["In an App Router route handler, read the body once with await req.text()", "Pass that string, the stripe-signature header and STRIPE_WEBHOOK_SECRET to constructEvent", "Only JSON-parse after verification (event is already parsed for you)", "If it still fails, check which whsec_ secret is in use"],
    code: { file: "src/app/api/stripe/webhook/route.ts", body: ROUTE },
    before: `// src/app/api/stripe/webhook/route.ts
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const payload = await req.json();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(JSON.stringify(payload), sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(\`Invalid signature: \${(err as Error).message}\`, { status: 400 });
  }
  // ...handle event.type...
  return Response.json({ received: true });
}`,
    prompt: "My Stripe webhook fails with 'No signatures found matching the expected signature'. Open src/app/api/stripe/webhook/route.ts and make sure the body is read once with await req.text() and passed unmodified to stripe.webhooks.constructEvent with the stripe-signature header. Remove any req.json(), JSON.stringify or body-parsing wrapper before verification. Don't change the event handling."
  },
  {
    id: "wrong-secret",
    quick: "use the whsec_ of THIS endpoint + mode",
    name: "Wrong webhook secret (CLI vs Dashboard, test vs live)",
    where: "server log",
    looksLike: "No signatures found matching the expected signature for payload  (works locally with stripe listen, fails in production)",
    match: ["whsec", "webhook secret", "signing secret", "stripe_webhook_secret", "works locally", "live mode", "test mode"],
    means: "Every endpoint has its own signing secret. The secret printed by stripe listen only verifies events forwarded by the CLI. A Dashboard endpoint has a different one, and test-mode and live-mode endpoints have different ones too.",
    causes: ["The stripe listen whsec_ is set in production", "A test-mode secret is used with a live-mode endpoint (or the reverse)", "You rolled the secret in the Dashboard and didn't redeploy", "Extra quotes or a trailing space in the env var"],
    fix: ["Stripe Dashboard \u2192 Developers \u2192 Webhooks \u2192 your endpoint \u2192 reveal the signing secret", "Set it as STRIPE_WEBHOOK_SECRET in the production environment (the matching mode: live for live keys)", "Redeploy so the running build sees the new value", "Keep the stripe listen secret only in .env.local"],
    code: { file: ".env.local", body: "# local only: printed by `stripe listen`\nSTRIPE_WEBHOOK_SECRET=whsec_from_stripe_listen\n\n# production (set on your host, not in git):\n# STRIPE_WEBHOOK_SECRET=whsec_from_dashboard_endpoint" },
    prompt: "Stripe webhook signature checks pass locally but fail in production. List every place STRIPE_WEBHOOK_SECRET is read, confirm the code trims nothing weird, and give me a checklist to confirm production uses the Dashboard endpoint's signing secret for the same mode (test/live) as STRIPE_SECRET_KEY. Do not hardcode any secret.",
    prodOnly: true
  },
  {
    id: "redirect-3xx",
    quick: "register the exact final URL",
    name: "307 / 308 / 301 redirect",
    where: "Stripe Dashboard",
    looksLike: "Webhook delivery failed: HTTP status code 308 (Permanent Redirect)",
    match: ["307", "308", "301", "302", "redirect", "temporary redirect", "permanent redirect", "trailing slash", "www"],
    means: "Stripe does not follow redirects. Any 3xx counts as a failed delivery. Next.js and hosts redirect apex to www (or the reverse), http to https, and add or strip trailing slashes.",
    causes: ["Endpoint registered as https://example.com but the site redirects to https://www.example.com", "trailingSlash: true in next.config adds a slash and redirects", "http:// instead of https://", "A locale or auth redirect in proxy.ts / middleware.ts"],
    fix: ["Run curl -i -X POST https://your-url/api/stripe/webhook and look at the status and Location header", "Update the Dashboard endpoint to the final URL from Location, exactly", "Exclude /api/stripe/webhook from locale and auth redirects"],
    code: { file: "terminal", body: "curl -i -X POST https://example.com/api/stripe/webhook\n# HTTP/2 308\n# location: https://www.example.com/api/stripe/webhook   <- register THIS url\n\n# A healthy endpoint answers 400 (missing signature), not 3xx/401/404." },
    prompt: "Stripe shows my webhook failing with a 307/308 redirect. Check next.config (trailingSlash, redirects), proxy.ts/middleware.ts and any locale or auth redirects, and tell me the exact final URL Stripe should call. Make sure /api/stripe/webhook is never redirected.",
    prodOnly: true
  },
  {
    id: "unauthorized-401",
    quick: "exclude the route from auth / deployment protection",
    name: "401 / 403 from auth middleware or Vercel Deployment Protection",
    where: "Stripe Dashboard",
    looksLike: "Webhook delivery failed: HTTP status code 401 (Unauthorized)",
    match: ["401", "403", "unauthorized", "forbidden", "deployment protection", "vercel authentication", "password protection", "middleware", "proxy.ts"],
    means: "Something answered before your handler ran. Stripe has no session cookie, so auth middleware rejects it or redirects it to sign-in. On Vercel, Deployment Protection (Vercel Authentication) blocks preview deployments, and sometimes production, with a 401.",
    causes: ["proxy.ts / middleware.ts protects /api/* and the matcher doesn't exclude the webhook", "Vercel Deployment Protection is on for the URL Stripe calls (often a preview URL)", "Cloudflare / WAF bot protection challenges Stripe's requests", "Basic auth on a staging site"],
    fix: ["Exclude /api/stripe/webhook from the middleware matcher: the Stripe signature is its authentication", "Point Stripe at your production domain, not a *.vercel.app preview URL", "Or turn off Deployment Protection for that URL, or use Vercel's Protection Bypass for Automation", "Allow Stripe's webhook IPs through your WAF if needed"],
    code: { file: "src/proxy.ts", body: 'export const config = {\n  // run everywhere except static files and the Stripe webhook\n  matcher: ["/((?!api/stripe/webhook|_next/static|_next/image|favicon.ico).*)"],\n};' },
    before: 'export const config = {\n  // run everywhere except static files\n  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],\n};',
    prompt: "Stripe gets 401/403 from my webhook. Find every proxy.ts/middleware.ts matcher, auth check or wrapper that runs on /api/stripe/webhook and exclude that route, keeping signature verification as its only auth. Also tell me if the URL in Stripe is a Vercel preview URL behind Deployment Protection.",
    prodOnly: true
  },
  {
    id: "not-found-404",
    quick: "match the URL to the route file path",
    name: "404 Not Found (wrong path)",
    where: "Stripe Dashboard",
    looksLike: "Webhook delivery failed: HTTP status code 404 (Not Found)",
    match: ["404", "not found", "wrong path", "no route"],
    means: "Nothing answers at the URL Stripe calls. In the App Router, the URL comes from the folder path of route.ts, and only exported HTTP method names are handlers.",
    causes: ["Endpoint is /api/webhooks/stripe but the file is app/api/stripe/webhook/route.ts", "The file is named webhook.ts or page.tsx instead of route.ts", "The handler isn't exported as POST (e.g. export default)", "A typo, or a missing /api prefix, or a basePath"],
    fix: ["Map the URL to the file: /api/stripe/webhook \u2192 src/app/api/stripe/webhook/route.ts", "Export a named function: export async function POST(req: Request)", "Test with curl -i -X POST: you should get 400 (missing signature), not 404"],
    prompt: "Stripe gets a 404 from my webhook URL. Find the actual webhook route file, tell me the URL it serves (including basePath), confirm it exports a named POST handler, and tell me what to put in the Stripe Dashboard."
  },
  {
    id: "timeout",
    quick: "return 2xx fast, do slow work later",
    name: "Timed out / not returning 2xx fast",
    where: "Stripe Dashboard",
    looksLike: "Webhook delivery failed: Timed out connecting to remote host",
    match: ["timed out", "timeout", "time out", "took too long", "504", "function_invocation_timeout", "slow"],
    means: "Stripe expects a 2xx quickly. If your handler sends emails, calls other APIs or waits on a cold database before answering, the request can time out (around 10 seconds or more counts as a failure) and Stripe retries it, which also causes duplicates.",
    causes: ["Sending email or calling third-party APIs inside the handler", "Cold start plus a slow database connection", "Serverless function timeout on your host", "Awaiting work that isn't needed to acknowledge the event"],
    fix: ["Verify the signature, do the minimal DB write, return 200", "Move slow work to a queue or background job (or after() in Next.js)", "Keep the handler idempotent because retries will come"],
    code: { file: "route.ts (after verifying)", body: 'import { after } from "next/server";\n\nawait recordEvent(event);            // fast, idempotent DB write\nafter(() => sendReceiptEmail(event)); // runs after the response\nreturn Response.json({ received: true });' },
    before: "await recordEvent(event);\nawait sendReceiptEmail(event); // Stripe waits for this\nawait syncToCrm(event);         // ...and this\nreturn Response.json({ received: true });",
    prompt: "My Stripe webhook times out. Profile src/app/api/stripe/webhook/route.ts: keep signature verification and the minimal idempotent DB write, then return 200. Move emails and third-party calls out of the request path (after() or a queue). Don't change what gets written.",
    prodOnly: true
  },
  {
    id: "duplicate-events",
    quick: "store event.id, skip repeats",
    name: "Duplicate events / missing idempotency",
    where: "symptom",
    looksLike: "Same checkout.session.completed processed twice: two welcome emails, credits granted twice",
    match: ["duplicate", "twice", "idempot", "same event", "processed twice", "retry", "retries", "double"],
    means: "Stripe delivers at least once. Retries after a timeout or non-2xx, and occasionally plain duplicates, mean the same event.id can arrive more than once. Handlers that increment, insert or send emails without checking will repeat the side effect.",
    causes: ["No record of which event.id values were already processed", "Incrementing credits or inserting rows instead of writing current state", "A slow handler that Stripe retried"],
    fix: ["Store event.id with a unique constraint before doing side effects; skip if it already exists", "Prefer writing the current state (status = X) over increments or toggles", "Return 200 for duplicates so Stripe stops retrying"],
    code: { file: "prisma/schema.prisma + route.ts", body: "model StripeEvent {\n  id        String   @id // evt_...\n  createdAt DateTime @default(now())\n}\n\n// in the handler, after constructEvent:\ntry {\n  await db.stripeEvent.create({ data: { id: event.id } });\n} catch {\n  return Response.json({ received: true, duplicate: true });\n}" },
    before: "model StripeEvent {\n  id        String   @id // evt_...\n  createdAt DateTime @default(now())\n}\n\n// in the handler, after constructEvent:\nawait db.user.update({\n  where: { id: userId },\n  data: { credits: { increment: 100 } }, // runs again on every retry\n});",
    prompt: "Make my Stripe webhook idempotent. Add a StripeEvent table keyed by event.id (unique), insert it right after signature verification and return 200 early if it already exists. Change any increments or one-off side effects so a repeated event is harmless. Add a test that sends the same event twice."
  },
  {
    id: "out-of-order",
    quick: "re-fetch the object from Stripe",
    name: "Out-of-order events",
    where: "symptom",
    looksLike: "customer.subscription.updated (active) arrived after customer.subscription.deleted, user got Pro back",
    match: ["out of order", "out-of-order", "wrong order", "order", "stale", "arrived after", "subscription.updated", "subscription.deleted"],
    means: "Stripe doesn't guarantee delivery order. A retried older event can land after a newer one, so writing event.data.object blindly can overwrite fresh state with stale state.",
    causes: ["Writing the event payload snapshot straight to the database", "Assuming created always arrives before updated", "Retries of an old event"],
    fix: ["Take only the object id from the event", "Re-fetch the subscription with stripe.subscriptions.retrieve(id) and write its current state", "Or compare event.created / a stored timestamp and ignore older events"],
    code: { file: "src/lib/billing.ts", body: 'case "customer.subscription.updated":\ncase "customer.subscription.deleted": {\n  const sub = await stripe.subscriptions.retrieve(event.data.object.id);\n  await db.user.updateMany({\n    where: { stripeCustomerId: sub.customer as string },\n    data: { subscriptionStatus: sub.status },\n  });\n  break;\n}' },
    before: 'case "customer.subscription.updated":\ncase "customer.subscription.deleted": {\n  const sub = event.data.object; // may be an old, late-retried snapshot\n  await db.user.updateMany({\n    where: { stripeCustomerId: sub.customer as string },\n    data: { subscriptionStatus: sub.status },\n  });\n  break;\n}',
    prompt: "My Stripe webhook can apply stale subscription state when events arrive out of order. Change the handler to take only the subscription id from the event, re-fetch it with stripe.subscriptions.retrieve, and write its current state. Add a test where updated(active) arrives after deleted."
  },
  {
    id: "edge-runtime",
    quick: 'runtime = "nodejs" or constructEventAsync',
    name: "Edge runtime / crypto errors",
    where: "server log",
    looksLike: "SubtleCryptoProvider cannot be used in a synchronous context. Use `await constructEventAsync(...)` instead of `constructEvent(...)`",
    match: ["subtlecryptoprovider", "constructeventasync", "synchronous context", "edge runtime", 'runtime = "edge"', "crypto", "cloudflare", "workers", "module not found: can't resolve 'crypto'"],
    means: "constructEvent is synchronous and uses Node's crypto. On the Edge runtime or Cloudflare Workers only Web Crypto exists, which is async.",
    causes: ['export const runtime = "edge" on the webhook route', "Deploying to Cloudflare Workers / Pages", "A bundler polyfill that breaks node:crypto"],
    fix: ['Simplest: export const runtime = "nodejs" on the webhook route', "On Edge/Workers: await stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider())", "Still read the body with await req.text()"],
    code: { file: "route.ts (Edge / Workers)", body: "const event = await stripe.webhooks.constructEventAsync(\n  await req.text(),\n  sig,\n  process.env.STRIPE_WEBHOOK_SECRET!,\n  undefined,\n  Stripe.createSubtleCryptoProvider(),\n);" },
    before: 'export const runtime = "edge";\n\nconst event = stripe.webhooks.constructEvent(\n  await req.text(),\n  sig,\n  process.env.STRIPE_WEBHOOK_SECRET!,\n);',
    prompt: `My Stripe webhook throws a crypto/SubtleCryptoProvider error. Check the runtime of src/app/api/stripe/webhook/route.ts. If I'm not deploying to an edge-only platform, set runtime = "nodejs". Otherwise switch to await constructEventAsync with Stripe.createSubtleCryptoProvider().`,
    prodOnly: true
  },
  {
    id: "missing-raw-body",
    quick: "read req.text(), don't use bodyParser config",
    name: "Missing raw body / body already used",
    where: "server log",
    looksLike: "TypeError: Body is unusable: Body has already been read  \xB7  Webhook payload must be provided as a string or a Buffer",
    match: ["body is unusable", "already been read", "payload must be provided as a string or a buffer", "bodyparser", "raw body", "rawbody", "buffer", "micro"],
    means: "The request body stream can be read once. If something read it already, or you pass an object instead of the raw string, verification can't run. The Pages Router bodyParser: false config does nothing in App Router route handlers.",
    causes: ["Reading req.json() for logging, then req.text() for verification", "Copying a Pages Router example (export const config = { api: { bodyParser: false } }, micro's buffer())", "Passing a parsed object to constructEvent"],
    fix: ["Read once: const body = await req.text()", "Delete Pages Router body config and the micro dependency from App Router routes", "If you need to log, log after verification using the event object"],
    code: { file: "src/app/api/stripe/webhook/route.ts", body: ROUTE },
    before: `// src/app/api/stripe/webhook/route.ts
import Stripe from "stripe";

// Pages Router config: ignored by App Router route handlers
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  console.log("webhook", await req.json()); // body is now used up
  const body = await req.text(); // throws: Body is unusable
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(\`Invalid signature: \${(err as Error).message}\`, { status: 400 });
  }
  // ...handle event.type...
  return Response.json({ received: true });
}`,
    prompt: "My Stripe webhook can't get the raw body. Rewrite src/app/api/stripe/webhook/route.ts for the App Router: read the body once with await req.text(), verify with constructEvent, remove any Pages Router bodyParser config or micro buffer() code, and don't read the body anywhere else."
  },
  {
    id: "events-not-enabled",
    quick: "add the event types to the endpoint",
    name: "Events not enabled on the endpoint (nothing arrives)",
    where: "symptom",
    looksLike: "Payment succeeded in Stripe but my webhook never fired / no deliveries listed for the endpoint",
    match: ["never fired", "not receiving", "no events", "nothing arrives", "not triggered", "never called", "no deliveries", "not enabled", "event types"],
    means: "A Dashboard endpoint only receives the event types you selected, in the mode (test or live) where you created it. Stripe CLI forwarding doesn't reach production.",
    causes: ["checkout.session.completed or customer.subscription.* not selected", "The endpoint was created in test mode but the payment was live (or the reverse)", "Endpoint disabled after repeated failures", "Listening on a connected account instead of your account"],
    fix: ["Dashboard \u2192 Developers \u2192 Webhooks \u2192 endpoint \u2192 check the event list and mode", "For subscriptions add checkout.session.completed and customer.subscription.created/updated/deleted", "Use 'Send test event' or stripe trigger checkout.session.completed to confirm delivery"],
    prompt: "My Stripe webhook never fires. List every event.type my handler handles so I can enable exactly those on the Dashboard endpoint, and give me the stripe trigger commands to test each one locally.",
    prodOnly: true
  },
  {
    id: "stripe-listen",
    quick: "stripe listen --forward-to localhost:3000/...",
    name: "stripe listen forwarding problems (local)",
    where: "Stripe CLI",
    looksLike: '[ERROR] Failed to POST: Post "http://localhost:3000/api/webhook": dial tcp [::1]:3000: connect: connection refused',
    match: ["stripe listen", "forward-to", "failed to post", "connection refused", "dial tcp", "localhost:3000", "stripe trigger", "--forward-to"],
    means: "The CLI receives events and forwards them to a local URL. It fails if the dev server isn't running, the port or path is wrong, or your app uses a different secret than the one stripe listen printed.",
    causes: ["next dev isn't running, or runs on another port", "Wrong path in --forward-to", "localhost resolves to IPv6 ::1 while the server listens on IPv4", "STRIPE_WEBHOOK_SECRET is the Dashboard secret, not the CLI one"],
    fix: ["Start next dev first, then stripe listen --forward-to localhost:3000/api/stripe/webhook", "Copy the whsec_ it prints into .env.local and restart next dev", "Try 127.0.0.1 instead of localhost if you see [::1] connection refused", "Fire a test with stripe trigger checkout.session.completed"],
    code: { file: "terminal", body: "npm run dev\nstripe listen --forward-to localhost:3000/api/stripe/webhook\n# copy the printed whsec_... into .env.local, restart dev\nstripe trigger checkout.session.completed" },
    prompt: "Set up local Stripe webhook testing for this app. Tell me the exact stripe listen --forward-to command for my webhook route and port, which env var gets the printed whsec_, and which stripe trigger commands cover the events my handler uses."
  },
  {
    id: "timestamp-tolerance",
    quick: "fix the clock, don't replay old payloads",
    name: "Timestamp outside the tolerance zone",
    where: "server log",
    looksLike: "StripeSignatureVerificationError: Timestamp outside the tolerance zone",
    match: ["timestamp outside the tolerance zone", "tolerance zone", "tolerance", "clock skew", "timestamp"],
    means: "The stripe-signature header carries a timestamp, and the library rejects events older than the tolerance (300 seconds by default) to stop replay attacks. Either your server clock is off, or you're replaying an old saved payload.",
    causes: ["Server or container clock drift (no NTP)", "Replaying a saved request from a fixture or log", "Queueing the raw request and verifying it minutes later"],
    fix: ["Sync the server clock (NTP) and check date -u against real UTC", "Verify the signature as soon as the request arrives, then queue the parsed event", "For tests, generate fresh headers with stripe.webhooks.generateTestHeaderString instead of old ones"],
    prompt: "My Stripe webhook fails with 'Timestamp outside the tolerance zone'. Check whether verification happens immediately on receipt or later from a queue, and whether tests replay stale signed payloads. Make verification run on receipt and use stripe.webhooks.generateTestHeaderString in tests. Don't raise the tolerance."
  },
  {
    id: "customer-mapping",
    quick: "client_reference_id / metadata + stripeCustomerId",
    name: "Can't map the event to a user (missing metadata / customer id)",
    where: "symptom",
    looksLike: "Webhook returns 200 but the user is still on Free / updateMany count: 0 / Cannot read properties of undefined (reading 'userId')",
    match: ["metadata", "client_reference_id", "userid", "user id", "count: 0", "still on free", "not upgraded", "customer id", "stripecustomerid", "no user"],
    means: "The webhook ran but couldn't tell which of your users the event belongs to. Subscription events carry a customer id, not your user id, so you need a stored stripeCustomerId or metadata set when the Checkout Session was created.",
    causes: ["Checkout Session created without client_reference_id or metadata.userId", "stripeCustomerId never saved on the user", "A new Customer created per checkout (customer_email) instead of reusing one", "Reading metadata from the subscription when you only set it on the session"],
    fix: ["Create Checkout with client_reference_id: user.id (and subscription_data.metadata.userId if you need it on the subscription)", "On checkout.session.completed save session.customer as the user's stripeCustomerId", "Look up later subscription events by stripeCustomerId; pass customer for returning users"],
    code: { file: "checkout route", body: 'await stripe.checkout.sessions.create({\n  mode: "subscription",\n  line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],\n  client_reference_id: user.id,\n  subscription_data: { metadata: { userId: user.id } },\n  ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),\n  success_url: `${origin}/billing?success=1`,\n  cancel_url: `${origin}/billing`,\n});' },
    before: 'await stripe.checkout.sessions.create({\n  mode: "subscription",\n  line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],\n  success_url: `${origin}/billing?success=1`,\n  cancel_url: `${origin}/billing`,\n});',
    prompt: "My Stripe webhook returns 200 but never updates the right user. Trace how a Checkout Session links to my user: add client_reference_id (and subscription_data.metadata.userId), save session.customer as stripeCustomerId on checkout.session.completed, and look subscription events up by stripeCustomerId. Log a warning when no user matches."
  },
  {
    id: "static-export",
    quick: "deploy the route to a server/runtime",
    name: "Static export can't run API routes",
    where: "build / deploy",
    looksLike: 'Error: export const dynamic = "force-static"/ output: export ... route /api/stripe/webhook cannot be exported  \xB7  405 Method Not Allowed',
    match: ['output: "export"', "output: 'export'", "static export", "next export", "405", "method not allowed", "cannot be exported", "force-static", "github pages", "s3"],
    means: 'With output: "export" Next.js produces only static files. A POST route handler that verifies signatures needs a server or a function runtime, so on a static host the webhook either fails the build or returns 404/405.',
    causes: ['output: "export" in next.config', "Hosting on a static-only host (GitHub Pages, plain S3, a Pages project with no functions)"],
    fix: ['Remove output: "export" and deploy to a host that runs Next.js (Vercel, Node, Docker, OpenNext on Cloudflare)', "Or keep the site static and run the webhook as a separate function / Worker", "Then register that function's URL in Stripe"],
    prompt: 'My Next.js app uses a static export but needs a Stripe webhook. Explain the options for this repo: drop output: "export" and deploy to a Next.js-capable host, or move the webhook into a separate serverless function / Worker. Recommend one and list the exact changes.',
    prodOnly: true
  }
];
function scoreError4(e, raw) {
  const q = raw.toLowerCase();
  if (!q.trim()) return 0;
  let s = 0;
  e.match.forEach((m, i) => {
    if (q.includes(m)) s += (i === 0 ? 10 : 4) + Math.min(m.length, 30) / 10;
  });
  const code = /status code (\d{3})|\b(30[1278]|40[134]|405|504)\b/.exec(q);
  const n = code?.[1] ?? code?.[2];
  if (n && e.match.includes(n)) s += 20;
  return s;
}

// src/lib/env-leaks.ts
var PUBLIC_PREFIXES = [
  { prefix: "NEXT_PUBLIC_", fw: "Next.js" },
  { prefix: "VITE_", fw: "Vite" },
  { prefix: "EXPO_PUBLIC_", fw: "Expo" },
  { prefix: "NUXT_PUBLIC_", fw: "Nuxt" },
  { prefix: "REACT_APP_", fw: "Create React App" },
  { prefix: "GATSBY_", fw: "Gatsby" },
  { prefix: "PUBLIC_", fw: "SvelteKit / Astro" }
];
var SECRET_VALUES = [
  { re: /^sk_live_/, what: "Stripe live secret key", rotate: "Stripe Dashboard \u2192 Developers \u2192 API keys \u2192 Roll key" },
  { re: /^sk_test_/, what: "Stripe (or Clerk) test secret key", rotate: "your provider's API keys page \u2192 roll the key" },
  { re: /^rk_(live|test)_/, what: "Stripe restricted key", rotate: "Stripe Dashboard \u2192 API keys \u2192 Restricted keys \u2192 Roll" },
  { re: /^whsec_/, what: "Stripe webhook signing secret", rotate: "Stripe Dashboard \u2192 Webhooks \u2192 your endpoint \u2192 Roll secret" },
  { re: /^sk-ant-/, what: "Anthropic API key", rotate: "Anthropic Console \u2192 API keys \u2192 delete and create a new one" },
  { re: /^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{16,}/, what: "OpenAI API key", rotate: "OpenAI platform \u2192 API keys \u2192 revoke and create a new one" },
  { re: /^xai-[A-Za-z0-9]{16,}/, what: "xAI API key", rotate: "xAI console \u2192 API keys \u2192 revoke and create a new one" },
  { re: /^gsk_[A-Za-z0-9]{16,}/, what: "Groq API key", rotate: "Groq console \u2192 API keys \u2192 revoke and create a new one" },
  { re: /^hf_[A-Za-z0-9]{16,}/, what: "Hugging Face token", rotate: "Hugging Face \u2192 Settings \u2192 Access Tokens \u2192 invalidate" },
  { re: /^r8_[A-Za-z0-9]{16,}/, what: "Replicate API token", rotate: "Replicate \u2192 Account \u2192 API tokens \u2192 revoke" },
  { re: /^re_[A-Za-z0-9_]{16,}/, what: "Resend API key", rotate: "Resend \u2192 API Keys \u2192 revoke and create a new one" },
  { re: /^SG\.[A-Za-z0-9_-]{10,}\./, what: "SendGrid API key", rotate: "SendGrid \u2192 Settings \u2192 API Keys \u2192 delete and recreate" },
  { re: /^(ghp_|gho_|ghs_|github_pat_)/, what: "GitHub token", rotate: "GitHub \u2192 Settings \u2192 Developer settings \u2192 tokens \u2192 revoke" },
  { re: /^xox[abprs]-/, what: "Slack token", rotate: "Slack app settings \u2192 OAuth & Permissions \u2192 rotate / reinstall" },
  { re: /^sb_secret_/, what: "Supabase secret key", rotate: "Supabase Dashboard \u2192 Project Settings \u2192 API Keys \u2192 roll the secret key" },
  { re: /^AKIA[0-9A-Z]{16}$/, what: "AWS access key ID", rotate: "AWS IAM \u2192 Users \u2192 Security credentials \u2192 deactivate and delete the key" },
  { re: /^(postgres(ql)?|mysql|mongodb(\+srv)?|redis|rediss|smtps?):\/\/[^:\s/]+:[^@\s]+@/, what: "connection string with a password", rotate: "change the database / SMTP user's password" }
];
var PUBLIC_VALUES = [
  { re: /^pk_(live|test)_/, what: "publishable key (Stripe or Clerk)" },
  { re: /^sb_publishable_/, what: "Supabase publishable key" },
  { re: /^phc_/, what: "PostHog project key" },
  { re: /^https:\/\/[a-f0-9]+@[\w.-]*sentry\.io\//, what: "Sentry DSN" }
];
var SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|DATABASE_URL|DB_URL|DIRECT_URL|POSTGRES_URL|MONGODB_URI|REDIS_URL|SMTP_PASS|EMAIL_SERVER|ADMIN_KEY|MASTER_KEY|ACCESS_KEY_ID|SIGNING_KEY|ENCRYPTION_KEY)/;
var SERVER_API_PROVIDER = /(OPENAI|ANTHROPIC|CLAUDE|XAI|GROK|GROQ|MISTRAL|COHERE|GEMINI|GOOGLE_GENERATIVE_AI|DEEPSEEK|PERPLEXITY|TOGETHER|FIREWORKS|OPENROUTER|REPLICATE|HUGGINGFACE|HF|ELEVENLABS|RESEND|SENDGRID|POSTMARK|MAILGUN|TWILIO|UPSTASH|PINECONE|STRIPE_SECRET|GITHUB_TOKEN|SLACK)/;
var isProviderKey = (key) => SERVER_API_PROVIDER.test(key) && /(_KEY|_TOKEN|_SECRET|_API_KEY|_AUTH_TOKEN)$/.test(key);
var PUBLIC_NAME_OK = /(PUBLISHABLE|ANON_KEY|_URL$|APP_NAME|SITE_NAME|POSTHOG_KEY|POSTHOG_HOST|SENTRY_DSN|GA_ID|GA_MEASUREMENT_ID|GTM_ID|PLAUSIBLE|UMAMI|MAPBOX_TOKEN|FIREBASE_|ALGOLIA_APP_ID|ALGOLIA_SEARCH)/;
function mask(v) {
  if (!v) return "(empty)";
  if (v.length <= 6) return "\u2022".repeat(v.length);
  const head = v.match(/^[A-Za-z]+[_-]((live|test|proj|ant|secret|publishable)[_-])?/)?.[0] ?? v.slice(0, 3);
  return `${head.slice(0, 14)}${"\u2022".repeat(Math.min(10, Math.max(4, v.length - head.length - 4)))}${v.slice(-4)}`;
}
function publicPrefix(key) {
  return PUBLIC_PREFIXES.find((p) => key.startsWith(p.prefix));
}
function jwtRole(v) {
  const parts = v.split(".");
  if (parts.length !== 3 || !v.startsWith("eyJ")) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}
function parseEnv(text) {
  const out2 = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const m = l.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=\s*(.*))?$/);
    if (!m) return;
    let v = (m[2] ?? "").trim();
    let badQuote = false;
    const q = v[0];
    if (q === '"' || q === "'" || q === "`") {
      const end = v.indexOf(q, 1);
      if (end === -1) badQuote = true;
      else v = v.slice(1, end);
    } else {
      v = v.replace(/\s+#.*$/, "");
    }
    out2.push({ key: m[1], value: v, line: i + 1, badQuote });
  });
  return out2;
}
var serverName = (key, prefix) => key.slice(prefix.length);
function leakPrompt(key, prefix) {
  const s = serverName(key, prefix);
  return `${key} is a secret but its ${prefix} prefix puts it in the browser bundle. Rename it to ${s} in every .env file and on the host, read process.env.${s} only in server code (route handlers, server actions, server components) and add import "server-only" to the module that reads it. If a client component needs the result, call a server route instead of passing the key. Don't add the prefix back to make an error go away.`;
}
function analyze(text) {
  const vars = parseEnv(text);
  const findings = [];
  const seen = /* @__PURE__ */ new Map();
  for (const { key, value, line, badQuote } of vars) {
    const pp = publicPrefix(key);
    const masked = mask(value);
    const secretVal = SECRET_VALUES.find((p) => p.re.test(value));
    const publicVal = PUBLIC_VALUES.find((p) => p.re.test(value));
    const role = jwtRole(value);
    const prev = seen.get(key);
    seen.set(key, line);
    if (prev) {
      findings.push({ key, line, masked, severity: "warn", title: "Defined twice", detail: `${key} is also set on line ${prev}. Most loaders keep only one of them, so the value you think you're using may not be the one that runs.`, fix: "Delete the duplicate line." });
    }
    if (badQuote) {
      findings.push({ key, line, masked, severity: "warn", title: "Unclosed quote", detail: "The value opens a quote that never closes. Depending on the loader you get the quote character in the value or a parse error.", fix: "Close the quote or remove it." });
    }
    if (pp) {
      if (secretVal) {
        findings.push({ key, line, masked, severity: "leak", title: `${secretVal.what} in the browser`, detail: `${pp.fw} copies every ${pp.prefix} variable into the JavaScript it sends to visitors, so anyone can read this ${secretVal.what} in DevTools. If this build was ever deployed, treat the key as public.`, fix: `Rotate it now (${secretVal.rotate}), then drop the ${pp.prefix} prefix and use it only on the server.`, prompt: leakPrompt(key, pp.prefix) });
        continue;
      }
      if (role === "service_role") {
        findings.push({ key, line, masked, severity: "leak", title: "Supabase service_role key in the browser", detail: "This JWT has role service_role, which skips Row Level Security. In the browser bundle anyone can read and write every table.", fix: "Rotate it in Supabase (Project Settings \u2192 API / JWT keys), use the anon or publishable key in the browser, and keep service_role on the server.", prompt: leakPrompt(key, pp.prefix) });
        continue;
      }
      if (publicVal || role === "anon") {
        findings.push({ key, line, masked, severity: "ok", title: "Public by design", detail: `${role === "anon" ? "Supabase anon key" : publicVal.what}. It's meant to be in the browser; access is limited by the provider (and by Row Level Security for Supabase).` });
        continue;
      }
      if (SECRET_NAME.test(key) || isProviderKey(key)) {
        findings.push({ key, line, masked, severity: "leak", title: "Secret-looking name with a public prefix", detail: `The name says server-only, but the ${pp.prefix} prefix ships the value to every visitor. AI agents often add the prefix to "fix" an undefined env var in a client component.`, fix: `Drop the ${pp.prefix} prefix, read it on the server, and rotate the value if this build was deployed.`, prompt: leakPrompt(key, pp.prefix) });
        continue;
      }
      if (/(_KEY|_TOKEN)$/.test(key) && !PUBLIC_NAME_OK.test(key)) {
        findings.push({ key, line, masked, severity: "warn", title: "Public key: check it's meant to be", detail: `This ends up in the browser bundle. That's fine for keys the provider calls publishable, client-side or browser keys (and you've restricted them), not for anything that can bill you or write data.`, fix: "Check the provider's docs. If it's a server key, drop the prefix and call it from a server route." });
        continue;
      }
      findings.push({ key, line, masked, severity: "ok", title: "Public, looks harmless", detail: "Visible to visitors, which is fine for URLs, names and IDs." });
      continue;
    }
    if (publicVal && /SECRET/.test(key)) {
      findings.push({ key, line, masked, severity: "warn", title: "Publishable key where a secret should be", detail: `${key} holds a ${publicVal.what}. Server calls that need the secret key will fail with an authentication error.`, fix: "Paste the secret key (sk_\u2026) here instead." });
      continue;
    }
    if ((key === "AUTH_SECRET" || key === "NEXTAUTH_SECRET") && value && value.length < 32 && !/replace|change|your|xxx/i.test(value)) {
      findings.push({ key, line, masked, severity: "warn", title: "Short auth secret", detail: `${value.length} characters. Auth.js signs and encrypts sessions with it, so use a long random value.`, fix: "Generate one with npx auth secret (or openssl rand -base64 33)." });
      continue;
    }
    if ((key === "NEXTAUTH_URL" || key === "AUTH_URL") && /localhost|127\.0\.0\.1/.test(value)) {
      findings.push({ key, line, masked: value, severity: "info", title: "Localhost auth URL", detail: "Fine on your laptop. If this line reaches production, sign-in redirects users to localhost.", fix: "Leave it out of production env vars (Auth.js v5 works out the URL from the request)." });
      continue;
    }
    if (secretVal || role === "service_role" || SECRET_NAME.test(key) || isProviderKey(key)) {
      findings.push({ key, line, masked, severity: "ok", title: "Server-only secret", detail: "No public prefix, so it stays out of the browser bundle as long as only server code reads it." });
      continue;
    }
    findings.push({ key, line, masked, severity: "ok", title: "Server-only", detail: "Not exposed to the browser." });
  }
  const sk = vars.find((v) => /^(sk|rk)_(live|test)_/.test(v.value));
  const pk = vars.find((v) => /^pk_(live|test)_/.test(v.value) && /STRIPE/.test(v.key));
  if (sk && pk) {
    const skMode = sk.value.includes("_live_") ? "live" : "test";
    const pkMode = pk.value.includes("_live_") ? "live" : "test";
    if (skMode !== pkMode) {
      findings.push({ key: `${sk.key} + ${pk.key}`, line: pk.line, masked: `${skMode} + ${pkMode}`, severity: "warn", title: "Stripe live and test keys mixed", detail: `Your secret key is ${skMode} mode and your publishable key is ${pkMode} mode. Objects made with one don't exist in the other, so checkout fails with "No such price" or "No such customer".`, fix: "Use keys from the same mode, and a webhook secret from that mode too." });
    }
  }
  const order = { leak: 0, warn: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return {
    findings,
    vars: vars.length,
    publicVars: vars.filter((v) => publicPrefix(v.key)).length,
    leaks: findings.filter((f) => f.severity === "leak").length,
    warns: findings.filter((f) => f.severity === "warn").length
  };
}

// src/lib/middleware-to-proxy.ts
function convert(src) {
  const changes = [];
  let out2 = src.replace(/\r\n/g, "\n");
  const rep = (re, to, change) => {
    if (re.test(out2)) {
      out2 = out2.replace(re, to);
      changes.push(change);
    }
    re.lastIndex = 0;
  };
  rep(/export\s*\{\s*auth\s+as\s+middleware\s*\}/g, "export { auth as proxy }", {
    kind: "changed",
    title: "export { auth as middleware } \u2192 export { auth as proxy }",
    detail: "Auth.js v5 on Next.js 16 exports its auth function as proxy. Your authorized callback in auth.ts keeps working unchanged."
  });
  rep(/export\s*\{\s*default\s+as\s+middleware\s*\}/g, "export { default as proxy }", {
    kind: "changed",
    title: "Re-export renamed to proxy",
    detail: "The re-exported function is now exported as proxy."
  });
  rep(/export\s+(async\s+)?function\s+middleware\s*\(/g, (_m, a) => `export ${a ?? ""}function proxy(`, {
    kind: "changed",
    title: "export function middleware \u2192 export function proxy",
    detail: "Next.js 16 looks for a function named proxy (or a default export) in proxy.ts. This is the same rename the official middleware-to-proxy codemod makes."
  });
  rep(/export\s+default\s+(async\s+)?function\s+middleware\s*\(/g, (_m, a) => `export default ${a ?? ""}function proxy(`, {
    kind: "changed",
    title: "Default export renamed to proxy",
    detail: "A default export works in proxy.ts too; the function name was updated to match."
  });
  rep(/export\s+const\s+middleware\s*([:=])/g, (_m, c2) => `export const proxy ${c2}`, {
    kind: "changed",
    title: "export const middleware \u2192 export const proxy",
    detail: "Wrapped handlers (for example auth((req) => \u2026)) are exported as proxy."
  });
  if (/export\s*\{[^}]*\bmiddleware\b[^}]*\}/.test(out2) && /(function|const|let)\s+middleware\b/.test(out2)) {
    out2 = out2.replace(/\b(function|const|let)\s+middleware\b/g, "$1 proxy").replace(/(export\s*\{[^}]*)\bmiddleware\b/g, "$1proxy");
    changes.push({ kind: "changed", title: "Local middleware function renamed to proxy", detail: "The declaration and the export list now use proxy." });
  }
  rep(/\bNextMiddleware\b/g, "NextProxy", {
    kind: "changed",
    title: "NextMiddleware \u2192 NextProxy",
    detail: "NextMiddleware is a deprecated alias in Next.js 16; NextProxy is the same type under the new name."
  });
  rep(/\bMiddlewareConfig\b/g, "ProxyConfig", {
    kind: "changed",
    title: "MiddlewareConfig \u2192 ProxyConfig",
    detail: "MiddlewareConfig is a deprecated alias of ProxyConfig in Next.js 16."
  });
  rep(/^[ \t]*export\s+const\s+runtime\s*=\s*['"][^'"]*['"]\s*;?[ \t]*\n?/gm, "", {
    kind: "removed",
    title: "Removed export const runtime",
    detail: "Proxy runs on the Node.js runtime by default, and the Next.js docs say setting the runtime option in a proxy file throws an error. If you needed Edge-only behavior, test it on Node.js."
  });
  rep(/^([ \t]*)runtime\s*:\s*['"][^'"]*['"]\s*,?[ \t]*\n/gm, "", {
    kind: "removed",
    title: "Removed runtime from config",
    detail: "The runtime option isn't available in proxy files. Proxy defaults to Node.js."
  });
  rep(/\bskipMiddlewareUrlNormalize\b/g, "skipProxyUrlNormalize", {
    kind: "changed",
    title: "skipMiddlewareUrlNormalize \u2192 skipProxyUrlNormalize",
    detail: "This flag lives in next.config, where it was renamed too. Update it there."
  });
  if (/next-auth\/middleware|withAuth\s*\(/.test(out2))
    changes.push({ kind: "warn", title: "next-auth v4 withAuth detected", detail: 'withAuth from next-auth/middleware is the v4 API. In Auth.js v5 export auth from your auth.ts instead: export { auth as proxy } from "@/auth" (plus an authorized callback), or wrap it: export const proxy = auth((req) => { \u2026 }).' });
  if (!/export\s+const\s+config\b/.test(out2) && /proxy/.test(out2))
    changes.push({ kind: "warn", title: "No matcher", detail: "Without config.matcher, proxy runs on every request, including _next/static, _next/image and public/ files. An auth redirect there can block your CSS, JS and images." });
  if (/export\s+const\s+config\b/.test(out2) && !/_next\/static|_next|\.\*\\\\\.|matcher\s*:\s*['"\[]\s*['"]\/(api|dashboard|login|admin|app|account|settings)/.test(out2))
    changes.push({ kind: "info", title: "Check the matcher", detail: "Make sure the matcher skips static assets (_next/static, _next/image, favicon.ico) and webhook routes like /api/stripe/webhook, which carry no session cookie." });
  if (/auth|session|token/i.test(out2))
    changes.push({ kind: "info", title: "Still check auth where the data is", detail: "The Next.js and Auth.js docs both say not to rely on proxy alone. Server Functions are POSTs to the page that uses them, so a matcher change can silently drop coverage. Call await auth() in every protected page, route handler and server action." });
  if (/\bmiddleware\b/.test(out2.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "").replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "")))
    changes.push({ kind: "warn", title: "middleware is still referenced", detail: "Some code still uses the name middleware (for example a helper or a chain). Rename it if it refers to this function." });
  if (!changes.some((c2) => c2.kind === "changed" || c2.kind === "removed") && out2.trim())
    changes.unshift({ kind: "info", title: "Nothing to rename", detail: "No middleware export was found. If this is already a proxy.ts, it may be fine as is. Rename the file to proxy.ts either way." });
  if (out2.trim())
    changes.unshift({ kind: "changed", title: "Rename the file: middleware.ts \u2192 proxy.ts", detail: "Same location as before: the project root, or src/ if your app lives there (next to app/ or pages/). Delete the old middleware.ts so you don't keep two." });
  return { output: out2, changes };
}

// src/lib/fixer-meta.ts
var ruleHref = (file) => `/tools/cursor-rules-pack#rule-${file.replace(/\.(mdc|md)$/, "")}`;
var APP = "nextjs-app-router.mdc";
var WF = "00-workflow.mdc";
var SEC = "security.mdc";
var HOOK = "stripe-webhooks.mdc";
var RULES = {
  authjs: {
    "v4-imports": { file: WF, why: "makes the agent check the installed next-auth version in package.json before writing auth code, so v4 examples don't land in a v5 app." }
  },
  nextjs: {
    "hook-in-server-component": { file: APP, why: 'puts "use client" only on the small leaf that needs state or effects.' },
    "event-handlers": { file: APP, why: "keeps pages as Server Components and moves onClick into a small client leaf." },
    "functions-to-client": { file: APP, why: "only serializable props cross to client components, and no functions other than Server Actions." },
    "plain-objects": { file: APP, why: "only plain objects, arrays, primitives and Dates are passed from server to client." },
    "metadata-in-client": { file: APP, why: "pages stay Server Components and titles come from the Metadata API." },
    "async-client-component": { file: APP, why: "data is fetched with async/await in Server Components, not inside client components." },
    "server-only-in-client": { file: APP, why: "server-only modules (database clients, secret readers) are never imported into client components." },
    "module-not-found-fs": { file: APP, why: "Node-only and server-only modules stay out of client components." },
    "prisma-in-browser": { file: SEC, why: 'database modules start with import "server-only", so a client import fails at build time instead of in the browser.' },
    "blocking-route": { file: APP, why: "with cacheComponents on, request-time data (cookies, session, per-user queries) goes inside <Suspense>." },
    "params-promise": { file: APP, why: "params and searchParams are awaited: const { slug } = await params." },
    "middleware-to-proxy": { file: APP, why: "on Next.js 16 the agent writes proxy.ts exporting proxy instead of middleware.ts." },
    "version-pinning": { file: WF, why: "the agent doesn't bump next, react or other framework packages unless the task asks for it." }
  },
  prisma: {
    "browser-bundle": { file: SEC, why: `database modules start with import "server-only", so they can't end up in a client bundle.` },
    "unknown-argument": { file: WF, why: "the agent searches the schema instead of inventing field names, and trusts the installed types over memory." },
    "argument-missing": { file: WF, why: "the agent reads the schema and installed types before writing a query, instead of guessing required fields." }
  },
  stripe: {
    "no-signatures-found": { file: HOOK, why: "reads the body once with await req.text() and verifies it before anything else." },
    "wrong-secret": { file: HOOK, why: "one whsec_ secret per endpoint and environment, and test keys never paired with live secrets." },
    "redirect-3xx": { file: HOOK, why: "excludes the webhook path from auth, locale and trailing-slash redirects." },
    "unauthorized-401": { file: HOOK, why: "keeps the webhook path out of your auth layer, since a 401 counts as a failed delivery." },
    "timeout": { file: HOOK, why: "returns 2xx once the event is recorded and runs slow work afterwards." },
    "duplicate-events": { file: HOOK, why: "records each event.id under a unique constraint and returns 200 for repeats without doing the work again." },
    "out-of-order": { file: HOOK, why: "re-fetches the object from Stripe instead of trusting event order or event.data.object." },
    "edge-runtime": { file: HOOK, why: "keeps the webhook handler on the Node.js runtime." },
    "missing-raw-body": { file: HOOK, why: "never calls req.json() before verifying the signature." },
    "events-not-enabled": { file: HOOK, why: "checks the production endpoint is subscribed to every event type the handler switches on." },
    "stripe-listen": { file: HOOK, why: "uses the whsec_ that stripe listen prints, only for local forwarding." },
    "customer-mapping": { file: "stripe.mdc", why: "sets client_reference_id (or metadata.userId) on every Checkout Session." }
  }
};
var LISTEN = "stripe listen --forward-to localhost:3000/api/stripe/webhook";
var ENV = "# put the whsec_... it prints in .env.local, then restart npm run dev";
var LOCAL = [LISTEN, ENV, "stripe trigger checkout.session.completed"];
var PROD = [
  "curl -i -X POST https://<your-domain>/api/stripe/webhook",
  "# expect 400 (missing signature) from your handler, not 3xx, 401, 403, 404 or 405",
  "stripe events resend evt_... --webhook-endpoint=we_...",
  "# we_... is the endpoint id in the Dashboard; add --live for a live-mode event"
];
var OK200 = "stripe listen prints [200] for every forwarded event, not 400 or 500.";
var PROD_OK = "curl gets 400 from your own handler, and the resent event shows a 200 delivery on the endpoint in the Dashboard.";
var STRIPE_VERIFY = {
  "no-signatures-found": { lines: LOCAL, expect: OK200 },
  "wrong-secret": { lines: [...LOCAL, "stripe events resend evt_... --webhook-endpoint=we_...", "# then the deployed endpoint; add --live for a live-mode event"], expect: "Local events return [200], and the resent event shows a 200 delivery on the deployed endpoint." },
  "redirect-3xx": { lines: PROD, expect: PROD_OK },
  "unauthorized-401": { lines: PROD, expect: PROD_OK },
  "not-found-404": { lines: PROD, expect: PROD_OK },
  "timeout": { lines: LOCAL, expect: "stripe listen prints [200] right away, before any slow work (emails, provisioning) finishes." },
  "duplicate-events": { lines: [...LOCAL, "stripe events resend evt_...   # the evt_ id stripe listen printed", "stripe events resend evt_...   # same id again"], expect: "All three deliveries return [200], the database changed once, and there's one stored row for that event id." },
  "out-of-order": { lines: [LISTEN, ENV, "stripe trigger customer.subscription.updated", "stripe events resend evt_...   # the customer.subscription.created event from that run"], expect: "After the older event is replayed, the stored subscription still matches what the Dashboard shows." },
  "edge-runtime": { lines: LOCAL, expect: OK200 },
  "missing-raw-body": { lines: LOCAL, expect: OK200 },
  "events-not-enabled": { lines: [LISTEN, ENV, "stripe trigger invoice.payment_failed", "# test-mode Dashboard endpoints receive triggered events too"], expect: "The event reaches your local handler with [200] and shows up as a delivery on the test-mode endpoint in the Dashboard." },
  "stripe-listen": { lines: [LISTEN, "stripe listen --print-secret   # the whsec_ to put in .env.local", "stripe trigger checkout.session.completed"], expect: OK200 },
  "timestamp-tolerance": { lines: ["date -u   # should match real UTC", ...LOCAL], expect: "Fresh events verify and return [200]. Don't raise the tolerance to make old payloads pass." },
  "customer-mapping": { lines: [LISTEN, ENV, "stripe trigger checkout.session.completed --add checkout_session:client_reference_id=<test-user-id>", "# the fixture is a one-time payment; also run one subscription checkout in test mode"], expect: "That test user's row gets the Stripe customer id, and a later subscription event finds the same user." },
  "static-export": { lines: PROD, expect: "curl gets 400 from your webhook function instead of 404 or 405, and the resent event shows a 200 delivery." }
};
var VERIFIED_ON = {
  nextjs: { "version-pinning": { on: "October 27, 2026", iso: "2026-10-27" } }
};

// src/lib/doctor.ts
var FIXER = {
  nextjs: { href: "/tools/nextjs-error-fixer", label: "Next.js error fixer", cta: "nextjs-error-fixer", versions: VERSIONS, on: CHECKED_ON, iso: CHECKED_ISO },
  authjs: { href: "/tools/authjs-error-fixer", label: "Auth.js error fixer", cta: "authjs-error-fixer", versions: VERSIONS2, on: CHECKED_ON2, iso: CHECKED_ISO2 },
  prisma: { href: "/tools/prisma-error-fixer", label: "Prisma error fixer", cta: "prisma-error-fixer", versions: VERSIONS3, on: CHECKED_ON3, iso: CHECKED_ISO3 },
  stripe: { href: "/tools/stripe-webhook-fixer", label: "Stripe webhook fixer", cta: "stripe-webhook-fixer", versions: VERSIONS4, on: CHECKED_ON4, iso: CHECKED_ISO4 }
};
function rule(tool, id) {
  const r = RULES[tool][id];
  return r ? { file: r.file, href: ruleHref(r.file), why: r.why.charAt(0).toUpperCase() + r.why.slice(1) } : void 0;
}
function toHit(tool, e, score) {
  const f = FIXER[tool];
  const later = VERIFIED_ON[tool]?.[e.id];
  return {
    tool,
    id: e.id,
    name: e.name,
    where: e.where,
    means: e.means,
    fix: e.fix,
    code: typeof e.code === "object" ? e.code : e.snippet,
    prompt: e.prompt,
    score,
    entryHref: `${f.href}#${e.id}`,
    fixer: f.label,
    cta: f.cta,
    versions: f.versions,
    verified: later?.on ?? f.on,
    verifiedIso: later?.iso ?? f.iso,
    rule: rule(tool, e.id)
  };
}
var SOURCES = [
  ["nextjs", NEXT_ERRORS, scoreError],
  ["authjs", AUTH_ERRORS, scoreError2],
  ["prisma", PRISMA_ERRORS, scoreError3],
  ["stripe", HOOK_ERRORS, scoreError4]
];
var ENTRY_COUNT = SOURCES.reduce((n, [, list]) => n + list.length, 0);
var ENTRY_COUNTS = Object.fromEntries(SOURCES.map(([t, list]) => [t, list.length]));
function matchErrors(raw, limit = 3) {
  const all = [];
  for (const [tool, list, score] of SOURCES) {
    for (const e of list) {
      const s = score(e, raw);
      if (s > 0) all.push(toHit(tool, e, s));
    }
  }
  all.sort((a, b) => b.score - a.score);
  const top = all[0]?.score ?? 0;
  return all.filter((h, i) => i === 0 || h.score >= Math.max(6, top * 0.35)).slice(0, limit);
}
function entryById(tool, id) {
  const src = SOURCES.find(([t]) => t === tool);
  const e = src?.[1].find((x) => x.id === id);
  return e ? toHit(tool, e, 0) : void 0;
}
function parseVer(spec) {
  const s = spec.trim();
  const m = /^(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  const n = (x) => x && /^\d+$/.test(x) ? Number(x) : 0;
  return { major: Number(m[1]), minor: n(m[2]), patch: n(m[3]), pre: m[4]?.slice(1) ?? "", exact: /^\d/.test(s) && !!m[3] && /^\d+$/.test(m[3]), raw: s };
}
function cmp(a, b) {
  return a.major - b[0] || a.minor - b[1] || a.patch - b[2];
}
var show = (name, spec) => `${name} ${spec}`;
function checkPackageJson(text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (e) {
    return { error: `That isn't valid JSON yet (${e.message.replace(/^JSON\.parse: /, "")}). Paste the whole package.json, including the outer { }.` };
  }
  if (!pkg || typeof pkg !== "object") return { error: "That isn't a package.json object." };
  const deps = { ...pkg.devDependencies ?? {}, ...pkg.dependencies ?? {} };
  const scripts = pkg.scripts ?? {};
  const has = (n) => typeof deps[n] === "string";
  const out2 = [];
  const stack = [];
  if (has("next")) {
    stack.push("Next.js");
    const spec = deps.next;
    const v = parseVer(spec);
    if (!v) {
      if (/^(latest|canary|\*|x)$/i.test(spec.trim()))
        out2.push({
          severity: "warn",
          title: `next is "${spec}", not a version`,
          entry: "version-pinning",
          detail: "Every fresh install can build against a different Next.js. Pin the exact version you last tested and commit package-lock.json.",
          fix: entryById("nextjs", "version-pinning")?.fix,
          rule: rule("nextjs", "version-pinning"),
          link: { href: `${FIXER.nextjs.href}#version-pinning`, label: "Full entry in the Next.js error fixer" },
          cta: FIXER.nextjs.cta
        });
    } else {
      if (v.major < 16) {
        out2.push({
          severity: "info",
          title: `${show("next", spec)} is older than Next.js 16`,
          detail: `The Next.js fixes here are verified on ${VERSIONS}. Some only apply after upgrading (proxy.ts instead of middleware.ts, params as a Promise), so tell your agent which version you're on before it writes code from newer examples.`,
          rule: rule("nextjs", "version-pinning"),
          link: { href: FIXER.nextjs.href, label: "Next.js error fixer" },
          cta: FIXER.nextjs.cta
        });
      } else {
        if (cmp(v, [16, 4, 5]) < 0)
          out2.push({
            severity: "warn",
            title: `${show("next", spec)} is older than 16.4.5, the Nov 3, 2026 security release`,
            detail: `Next.js 16.4.5 fixes 7 moderate advisories, including cross-user disclosure and cache poisoning in 'use cache', an SVG bypass in image optimization and an HttpOnly cookie exposure on Edge runtime routes. Check what's installed with npm ls next, then upgrade: npm install next@16.4.5 eslint-config-next@16.4.5, build, run your tests and commit package-lock.json. (The fixes here are verified on ${VERSIONS}; they apply to 16.4.5 too.)`,
            link: { href: "https://github.com/vercel/next.js/releases/tag/v16.4.5", label: "Next.js v16.4.5 release notes" }
          });
        const mw = entryById("nextjs", "middleware-to-proxy");
        out2.push({
          severity: "info",
          title: "Next.js 16: middleware.ts is now proxy.ts",
          entry: "middleware-to-proxy",
          detail: mw?.means ?? "Next.js 16 renamed middleware.ts to proxy.ts.",
          fix: mw?.fix,
          rule: rule("nextjs", "middleware-to-proxy"),
          link: { href: "/tools/middleware-to-proxy", label: "Convert middleware.ts to proxy.ts" },
          cta: "middleware-to-proxy"
        });
      }
      if (!v.exact)
        out2.push({
          severity: "warn",
          title: `next uses a range (${spec})`,
          entry: "version-pinning",
          detail: "A range like ^16.4.3 allows any later 16.x, so without a committed lockfile each install can build against a different Next.js. Agents also bump it while fixing something else.",
          fix: entryById("nextjs", "version-pinning")?.fix,
          rule: rule("nextjs", "version-pinning"),
          link: { href: `${FIXER.nextjs.href}#version-pinning`, label: "Full entry in the Next.js error fixer" },
          cta: FIXER.nextjs.cta
        });
    }
    const esl = deps["eslint-config-next"];
    const ev = esl ? parseVer(esl) : null;
    if (v && ev && (ev.major !== v.major || ev.minor !== v.minor || ev.patch !== v.patch))
      out2.push({
        severity: "warn",
        title: `next and eslint-config-next differ (${spec} vs ${esl})`,
        entry: "version-pinning",
        detail: "next, eslint-config-next and react changing in different commits is a common way package.json and package-lock.json drift apart. Keep next and eslint-config-next on the same version.",
        rule: rule("nextjs", "version-pinning"),
        link: { href: `${FIXER.nextjs.href}#version-pinning`, label: "Full entry in the Next.js error fixer" },
        cta: FIXER.nextjs.cta
      });
  } else {
    out2.push({ severity: "info", title: "No next dependency found", detail: "The Doctor's package.json checks are written for Next.js apps. Error matching still works for any pasted error." });
  }
  if (has("next-auth")) {
    stack.push("Auth.js");
    const spec = deps["next-auth"];
    const v = parseVer(spec);
    const e = entryById("authjs", "v4-imports");
    if (v && v.major <= 4)
      out2.push({
        severity: "warn",
        title: `next-auth ${spec} is NextAuth v4`,
        entry: "v4-imports",
        detail: `Most new examples (and the Auth.js fixer, checked on ${VERSIONS2}) are Auth.js v5: auth() instead of getServerSession(authOptions), NextAuthConfig instead of NextAuthOptions. Agents mix the two APIs unless you tell them which version you use.`,
        fix: ["Say which version you're on in AGENTS.md (for example: This project uses NextAuth v4, don't use the v5 auth() API), or migrate to Auth.js v5 on purpose, in its own branch", ...e ? [`Migrating? ${e.fix[0]}`] : []],
        rule: rule("authjs", "v4-imports"),
        link: { href: `${FIXER.authjs.href}#v4-imports`, label: "v4 vs v5 entry in the Auth.js error fixer" },
        cta: FIXER.authjs.cta
      });
    else if (v)
      out2.push({ severity: "ok", title: `next-auth ${spec} is Auth.js v5`, detail: `Matches what the Auth.js fixer is checked on (${VERSIONS2}). If your agent writes getServerSession or authOptions, that's v4 code.`, rule: rule("authjs", "v4-imports"), link: { href: FIXER.authjs.href, label: "Auth.js error fixer" } });
  }
  if (has("@next-auth/prisma-adapter"))
    out2.push({
      severity: "warn",
      title: "@next-auth/prisma-adapter is the v4 adapter",
      entry: "v4-imports",
      detail: "With Auth.js v5 the Prisma adapter is @auth/prisma-adapter. The old package is a sign of v4 code in the project.",
      fix: ["npm uninstall @next-auth/prisma-adapter", "npm install @auth/prisma-adapter", "Change the import in your auth.ts"],
      rule: rule("authjs", "v4-imports"),
      link: { href: `${FIXER.authjs.href}#v4-imports`, label: "v4 vs v5 entry in the Auth.js error fixer" },
      cta: FIXER.authjs.cta
    });
  if (has("@prisma/client") || has("prisma")) {
    stack.push("Prisma");
    const gen = /prisma\s+generate/;
    if (!gen.test(scripts.build ?? "") && !gen.test(scripts.postinstall ?? "")) {
      const e = entryById("prisma", "vercel-outdated-client");
      out2.push({
        severity: "warn",
        title: "Nothing runs prisma generate on install or build",
        entry: "vercel-outdated-client",
        detail: 'Vercel and Netlify reuse node_modules between builds, so the client can be generated for an older schema, or not at all ("did not initialize yet").',
        fix: e?.fix,
        rule: rule("prisma", "vercel-outdated-client"),
        link: { href: `${FIXER.prisma.href}#vercel-outdated-client`, label: "Full entry in the Prisma error fixer" },
        cta: FIXER.prisma.cta
      });
    } else {
      out2.push({ severity: "ok", title: "prisma generate runs on install or build", detail: 'That prevents the Vercel outdated-client and "did not initialize yet" errors.', link: { href: FIXER.prisma.href, label: "Prisma error fixer" } });
    }
    const a = deps.prisma, b = deps["@prisma/client"];
    const va = a ? parseVer(a) : null, vb = b ? parseVer(b) : null;
    if (va && vb && (va.major !== vb.major || va.minor !== vb.minor || va.patch !== vb.patch))
      out2.push({
        severity: "warn",
        title: `prisma and @prisma/client differ (${a} vs ${b})`,
        detail: "The CLI that generates the client and the runtime package should be the same version. Prisma's upgrade steps install both together.",
        fix: ["Install both at the same version, e.g. npm pkg set devDependencies.prisma=<version> dependencies.@prisma/client=<version>", "npm install, then npx prisma generate"],
        link: { href: FIXER.prisma.href, label: "Prisma error fixer" },
        cta: FIXER.prisma.cta
      });
    else if (b && !a)
      out2.push({ severity: "info", title: "@prisma/client without the prisma CLI", detail: "prisma generate needs the prisma package (usually a devDependency) at the same version as @prisma/client.", link: { href: FIXER.prisma.href, label: "Prisma error fixer" } });
  }
  if (has("stripe")) {
    stack.push("Stripe");
    const e = entryById("stripe", "no-signatures-found");
    out2.push({
      severity: "info",
      title: `${show("stripe", deps.stripe)}: check the webhook route`,
      entry: "no-signatures-found",
      detail: `The most common Stripe failure in the App Router is "No signatures found matching the expected signature": the handler parsed the body before verifying it. Read it once with await req.text() and pass that to constructEvent. Checked on ${VERSIONS4}.`,
      fix: e?.fix.slice(0, 3),
      rule: rule("stripe", "no-signatures-found"),
      link: { href: FIXER.stripe.href, label: `Stripe webhook fixer (${HOOK_ERRORS.length} failures)` },
      cta: FIXER.stripe.cta
    });
  }
  const order = { warn: 0, info: 1, ok: 2 };
  out2.sort((x, y) => order[x.severity] - order[y.severity]);
  return { name: pkg.name, deps: Object.keys(deps).length, findings: out2, stack };
}
function checkEnv(text) {
  const r = analyze(text);
  return { leaks: r.leaks, warns: r.warns, vars: r.vars, findings: r.findings.filter((f) => f.severity === "leak" || f.severity === "warn").slice(0, 4) };
}
function looksLikeMiddleware(text) {
  return /export\s+(default\s+)?(async\s+)?function\s+middleware\b|as\s+middleware\s*\}|export\s+const\s+middleware\s*=|next-auth\/middleware/.test(text);
}
function checkMiddleware(text) {
  return convert(text);
}

// ../vibeboot-doctor/src/cli.ts
var VERSION = "0.1.2";
var SITE = "https://vibeboot.dev";
var ref = (p) => /^https?:\/\//i.test(p) ? p : `${SITE}${p}${p.includes("?") ? "&" : "?"}ref=cli`;
var fixUrl = (h) => ref(`/fix/${h.tool}/${h.id}`);
var tty = process.stdout.isTTY && !process.env.NO_COLOR;
var c = (code) => (s) => tty ? `\x1B[${code}m${s}\x1B[0m` : s;
var green = c("38;2;57;255;20");
var red = c("31");
var yellow = c("33");
var dim = c("2");
var bold = c("1");
var out = [];
var say = (s = "") => out.push(s);
var wrap = (s, ind = "    ", w = Math.min(process.stdout.columns || 88, 100)) => {
  const words = s.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const wd of words) {
    if ((ind + cur + " " + wd).length > w && cur) {
      lines.push(ind + cur);
      cur = wd;
    } else cur = cur ? cur + " " + wd : wd;
  }
  if (cur) lines.push(ind + cur);
  return lines.join("\n");
};
var tag = { warn: yellow("WARN"), info: dim("INFO"), ok: green(" OK "), leak: red("LEAK") };
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
function printHit(h, i) {
  say(`${green(`${i + 1}.`)} ${bold(h.name)} ${dim(`(${h.fixer}, ${h.where})`)}`);
  say(wrap(h.means));
  h.fix.forEach((f) => say(wrap(`- ${f}`, "    ")));
  if (h.code) {
    say(dim(`    ${h.code.file}:`));
    h.code.body.split("\n").forEach((l) => say(dim(`      ${l}`)));
  }
  say(`    ${dim("Prompt for your agent:")}`);
  say(wrap(h.prompt, "      "));
  say(`    ${dim("Verified on")} ${h.versions}, ${h.verified}. ${dim("Full fix:")} ${fixUrl(h)}`);
  say();
}
function errorMode(text, json) {
  const hits = matchErrors(text, 3);
  if (json) {
    console.log(JSON.stringify({ mode: "error", matches: hits.map((h) => ({ ...h, url: fixUrl(h) })) }, null, 2));
    return hits.length ? 0 : 1;
  }
  if (!hits.length) {
    say(`No match among ${ENTRY_COUNT} known Next.js, Auth.js, Prisma and Stripe webhook errors.`);
    say(dim(`Paste the first error line plus a few lines after it. Browse every fix: ${ref("/fix")}`));
  } else {
    say(bold(`Best match${hits.length > 1 ? "es" : ""} for your error:`));
    say();
    hits.forEach(printHit);
  }
  return hits.length ? 0 : 1;
}
function readIf(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
function gitTracked(dir, files) {
  if (!files.length) return [];
  try {
    const r = execFileSync("git", ["-C", dir, "ls-files", "--", ...files], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return r.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
function projectMode(dir, json) {
  const abs = path.resolve(dir);
  const pkgText = readIf(path.join(abs, "package.json"));
  if (pkgText == null) {
    console.error(`No package.json in ${abs}. Run this in your project folder, or pass an error message in quotes.`);
    return 2;
  }
  const findings = [];
  const pkg = checkPackageJson(pkgText);
  let stack = [];
  if ("error" in pkg) findings.push({ severity: "warn", title: "package.json didn't parse", detail: pkg.error, file: "package.json" });
  else {
    stack = pkg.stack;
    pkg.findings.forEach((f) => findings.push({ severity: f.severity, title: f.title, detail: f.detail, fix: f.fix, file: "package.json", url: f.entry && f.link ? ref(f.link.href.startsWith("/tools/") && f.link.href.includes("#") ? `/fix/${toolOf(f.link.href)}/${f.entry}` : f.link.href) : f.link ? ref(f.link.href) : void 0 }));
  }
  const envNames = fs.readdirSync(abs).filter((n2) => /^\.env(\..+)?$/.test(n2) && !/\.(example|sample|template)$/.test(n2));
  let leaks = 0;
  for (const n2 of envNames) {
    const t = readIf(path.join(abs, n2));
    if (t == null) continue;
    const r = checkEnv(t);
    leaks += r.leaks;
    r.findings.forEach((f) => findings.push({ severity: f.severity === "leak" ? "leak" : "warn", title: `${n2}:${f.line} ${f.key} (${f.masked})`, detail: `${f.title}. ${f.detail}`, fix: f.fix ? [f.fix] : void 0, file: n2, url: ref("/tools/env-leak-checker") }));
  }
  const tracked = gitTracked(abs, envNames);
  if (tracked.length)
    findings.push({ severity: "leak", title: `Committed to git: ${tracked.join(", ")}`, detail: "Anyone with the repo can read these values. Remove the file from git, add .env* to .gitignore, and rotate every key that was in it (it stays in git history).", fix: [`git rm --cached ${tracked.join(" ")}`, "echo '.env*' >> .gitignore  (keep .env.example if you have one: add !.env.example)", "Rotate the keys in each provider's dashboard"], url: ref("/tools/env-leak-checker") });
  else if (envNames.length) {
    const gi = readIf(path.join(abs, ".gitignore")) ?? "";
    if (!/^\s*\/?\.env/m.test(gi)) findings.push({ severity: "warn", title: ".gitignore doesn't mention .env files", detail: `Found ${envNames.join(", ")} but no .env rule in .gitignore, so one git add . would commit your secrets.`, fix: ["Add .env* to .gitignore (and !.env.example to keep the example)"], file: ".gitignore", url: ref("/tools/env-leak-checker") });
  }
  for (const n2 of ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"]) {
    const t = readIf(path.join(abs, n2));
    if (t == null || !looksLikeMiddleware(t)) continue;
    const next16 = !("error" in pkg) && pkg.findings.some((f) => f.entry === "middleware-to-proxy");
    if (!next16) continue;
    const r = checkMiddleware(t);
    findings.push({ severity: "warn", title: `${n2} should be ${n2.replace("middleware", "proxy")} on Next.js 16`, detail: `Next.js 16 renamed middleware to proxy. ${r.changes.length} change${r.changes.length === 1 ? "" : "s"} needed: ${r.changes.map((x) => x.title).join("; ")}.`, fix: ["Paste the file into the converter for the rewritten proxy.ts and a diff"], file: n2, url: ref("/tools/middleware-to-proxy") });
  }
  const hasMw = findings.some((f) => /should be .*proxy/.test(f.title));
  const hasProxy = ["proxy.ts", "proxy.js", "src/proxy.ts", "src/proxy.js"].some((n2) => fs.existsSync(path.join(abs, n2)));
  const list = findings.filter((f) => !(f.title === "Next.js 16: middleware.ts is now proxy.ts" && (hasMw || hasProxy)));
  const order = { leak: 0, warn: 1, info: 2, ok: 3 };
  list.sort((a, b) => order[a.severity] - order[b.severity]);
  const n = (s) => list.filter((f) => f.severity === s).length;
  if (json) {
    console.log(JSON.stringify({ mode: "project", dir: abs, stack, findings: list }, null, 2));
    return n("leak") ? 1 : 0;
  }
  say(`${bold("VibeBoot Doctor")} ${dim(VERSION)}  ${abs}`);
  say(dim(`Stack: ${stack.join(", ") || "unknown"}. Checked package.json${envNames.length ? ", " + envNames.join(", ") : ""}${hasMw ? ", middleware" : ""}. Nothing left this machine.`));
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
function toolOf(href) {
  const m = /\/tools\/(nextjs|authjs|prisma|stripe-webhook)/.exec(href);
  const t = m?.[1] ?? "nextjs";
  return t === "stripe-webhook" ? "stripe" : t;
}
async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rest = args.filter((a) => !["--json", "--no-color"].includes(a));
  if (rest.includes("-h") || rest.includes("--help")) {
    help();
    return 0;
  }
  if (rest.includes("-v") || rest.includes("--version")) {
    console.log(VERSION);
    return 0;
  }
  let code;
  if (rest[0] === "-") {
    const chunks = [];
    for await (const ch of process.stdin) chunks.push(ch);
    code = errorMode(Buffer.concat(chunks).toString("utf8"), json);
  } else if (rest.length && !(fs.existsSync(rest[0]) && fs.statSync(rest[0]).isDirectory())) {
    code = errorMode(rest.join(" "), json);
  } else code = projectMode(rest[0] ?? ".", json);
  if (!json) {
    say(dim("Free and MIT. Want these fixed from day one? The VibeBoot starters ship with them handled, plus Cursor rules that stop agents re-breaking them:"));
    say(dim(`${SITE}/?ref=cli#starters`));
    console.log(out.join("\n"));
  }
  return code;
}
main().then((c2) => process.exit(c2), (e) => {
  console.error(e);
  process.exit(2);
});
