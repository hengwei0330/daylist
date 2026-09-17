# Daylist

A small to-do web app with a demo login. One folder of plain HTML, CSS and
JavaScript — no framework, no build step, no server.

Type a task and Daylist reads the details out of the sentence:

| You type                      | You get                            |
| ----------------------------- | ---------------------------------- |
| `call the dentist friday !!`  | due Friday, high priority          |
| `groceries tomorrow #home`    | due tomorrow, filed under `#home`  |
| `renew passport in 3 weeks`   | due three weeks out                |
| `dentist 10/2`                | due October 2                      |

It also understands `today`, `tonight`, `next week`, `next monday`, and
`2026-10-02`.

## Files

| File          | What it is                                                |
| ------------- | --------------------------------------------------------- |
| `login.html`  | Sign-in and create-account page                           |
| `index.html`  | The task list (markup only)                               |
| `app.js`      | All the task-list behaviour                               |
| `auth.js`     | The demo account system                                   |
| `styles.css`  | Design tokens and every style, shared by both pages       |
| `favicon.svg` | The icon in the browser tab                               |
| `vercel.json` | Optional Vercel settings (tidier URLs)                    |
| `.gitignore`  | Files Git should ignore                                   |

## Run it on your own computer

Double-click `index.html`. It opens in your browser and works. With no account
yet, it sends you to `login.html` to make one.

## Publish it on Vercel

### Option A — the Vercel CLI (fastest)

1. Install [Node.js](https://nodejs.org) if you don't have it.
2. Install the Vercel command-line tool: `npm install -g vercel`
3. In a terminal, move into this folder and run `vercel`.
   Accept the defaults; leave build command and output directory blank —
   this is a plain static site.
4. `vercel --prod` publishes the real URL.

Already deployed once? Just run `vercel --prod` again from this folder and
Vercel replaces the live version with whatever is in it now.

### Option B — GitHub, then import into Vercel

1. Put these files in a GitHub repository.
2. At vercel.com, add a new project and pick that repository.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Deploy. Every later `git push` redeploys automatically.

## How the login actually works — read this before you present it

`auth.js` fakes a login system **entirely inside the visitor's browser**. There
is no server, which means:

- Anyone can open developer tools and read every stored account.
- Anyone can edit those accounts, or delete the check that redirects to the
  login page, and walk straight in.
- An account does not exist on any other browser, device, or for any other
  visitor.

Passwords are salted and hashed with SHA-256 before being stored, so the raw
text is not lying around in plain sight. That is good hygiene, **not** security:
without a server the check itself can simply be bypassed.

So: perfectly fine as a classroom demonstration of what a login *flow* looks
like, and a good thing to be able to explain. Never a way to protect anything
real. Real authentication has to run on a server the visitor cannot edit — that
is the job of a backend, or a hosted service like Supabase, Clerk or Auth0.

## Where the tasks are stored

In `localStorage`, a small storage box every browser gives each website, keyed
to that site's address. Each account gets its own key, so two accounts on the
same computer keep separate lists.

Tasks survive closing the tab and restarting the computer. They do **not**
follow you to another browser, another laptop, or your phone. That is the
honest trade for a site with no database — and the exact point where you would
add one.
