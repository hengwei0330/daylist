# Daylist

A to-do web app with real accounts. Plain HTML, CSS and JavaScript on the
front; [Supabase](https://supabase.com) (hosted Postgres + authentication)
on the back. No framework, no build step.

Type a task and Daylist reads the details out of the sentence:

| You type                      | You get                            |
| ----------------------------- | ---------------------------------- |
| `call the dentist friday !!`  | due Friday, high priority          |
| `groceries tomorrow #home`    | due tomorrow, filed under `#home`  |
| `renew passport in 3 weeks`   | due three weeks out                |
| `dentist 10/2`                | due October 2                      |

It also understands `today`, `tonight`, `next week`, `next monday`, and
`2026-10-02`.

## Setup — do this once

### 1. Create the table

In Supabase: your project → **SQL Editor** → **New query** → paste all of
`supabase-setup.sql` → **Run**.

That makes the `tasks` table and, more importantly, the Row Level Security
rules that stop one account from reading another account's tasks.

### 2. Paste in your project's two public values

Supabase → your project → **Settings → API**. Copy:

- **Project URL** — like `https://abcdefgh.supabase.co`
- the **public API key** — labelled `anon` `public` on older dashboards,
  **Publishable key** on newer ones

Put both into `supabase-config.js`, replacing the `PASTE_...` placeholders.

> Never put the **service_role** / **secret** key in this file. That key
> ignores every security rule, and this file is downloaded by every visitor.

### 3. Decide about email confirmation

By default Supabase emails a confirmation link before a new account can sign
in. That's the right behaviour for a real product, and the app handles it —
after signing up you'll see a "confirm your email" screen.

For a live classroom demo the wait is awkward. To turn it off:
Supabase → **Authentication → Sign In / Providers → Email** → switch off
**Confirm email**. New signups are then signed in instantly.

## Files

| File                 | What it is                                            |
| -------------------- | ----------------------------------------------------- |
| `login.html`         | Sign-in and create-account page                       |
| `index.html`         | The task list (markup only)                           |
| `app.js`             | Task-list behaviour, reads and writes the database    |
| `auth.js`            | Wraps Supabase Auth: sign up, sign in, sign out       |
| `supabase-config.js` | **You fill this in** — your project URL and public key |
| `supabase-setup.sql` | Run once in Supabase's SQL editor                     |
| `styles.css`         | Design tokens and every style, shared by both pages   |
| `favicon.svg`        | The icon in the browser tab                           |
| `vercel.json`        | Optional Vercel settings                              |

## Running it locally

This version needs a real web server — opening `index.html` by double-clicking
uses the `file://` protocol, which browsers block from making the network
requests Supabase needs. Any static server works, for example:

    npx serve .

Then open the address it prints.

## Publishing on Vercel

Nothing special: it is still a static site with no build step. Push to your
GitHub repo and Vercel redeploys, or run `vercel --prod` from this folder.

`supabase-config.js` is committed on purpose — the values in it are meant to
be public. What protects the data is the Row Level Security rules, not the
secrecy of that key.

## How the security actually works

This is worth being able to explain, because it is the whole point of the
assignment.

**Authentication** — signing up creates a row in Supabase's `auth.users` table
on their servers. The password is hashed there; this app never sees the hash
and never stores the password. Signing in returns a short-lived access token
that the browser sends with every later request.

**Authorisation** — the public API key alone grants nothing. Every query is
filtered *inside Postgres* by the policies in `supabase-setup.sql`:

    using (auth.uid() = user_id)

`auth.uid()` is the account id carried by the request's token. So "give me all
tasks" silently returns only your own rows, and an attempt to write a row
belonging to someone else is rejected by the database.

That is the real difference from a browser-only login. Deleting JavaScript in
developer tools gets an attacker nowhere, because the rule is enforced
somewhere they cannot reach.

**What is still missing for a production app**: email address verification is
optional above, there is no password-strength policy beyond Supabase's
six-character minimum, no rate limiting beyond Supabase's defaults, and no
account-deletion flow. Worth naming if anyone asks what you would do next.
