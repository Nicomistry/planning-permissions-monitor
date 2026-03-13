# Planning Scraper — Setup Guide

## 1. Create a Trigger.dev project

1. Go to https://cloud.trigger.dev and sign up / log in
2. Create a new project → copy the **Project Ref** (looks like `proj_abc123`)
3. Open `trigger.config.ts` and replace `<YOUR_PROJECT_REF>` with it

## 2. Get API keys

| Key | Where to get it |
|-----|----------------|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| `RESEND_API_KEY` | https://resend.com/api-keys |

Fill in `.env` with both keys.

> **Resend note:** The `from` address is set to `onboarding@resend.dev` for testing (works without domain verification).
> To use your own domain, add it in the Resend dashboard and update the `from` line in `scrape.ts`.

## 3. Add env vars to Trigger.dev dashboard

In your Trigger.dev project → **Environment Variables**, add:
- `OPENROUTER_API_KEY`
- `RESEND_API_KEY`
- `DIGEST_EMAIL` = nicomistry@gmail.com

## 4. Install and run

```bash
cd planning-scraper
npm install
npm run dev
```

This starts the local dev worker. Keep it running.

## 5. Trigger a test run

In a second terminal (or from the Trigger.dev dashboard):

```bash
npx trigger.dev@latest trigger planning-scraper
```

Or open the Trigger.dev dashboard → your project → **Test** tab → select `planning-scraper` → Run.

## 6. Monitor

- Logs appear live in the terminal running `npm run dev`
- Full run history at https://cloud.trigger.dev → your project → Runs
- Email arrives at nicomistry@gmail.com when complete

## 7. Deploy to production

```bash
npm run deploy
```

After deploying, trigger runs from the Trigger.dev dashboard — no local machine needed.

---

## File overview

```
src/trigger/
  process-council.ts   ← runs per council: fetch → filter → AI classify → AI enrich → AI score
  scrape.ts            ← orchestrator: loops all councils → collects leads → sends email
```

## Adding more councils

In `scrape.ts`, add entries to the `COUNCILS` array:

```ts
{ name: "South Bucks", auth: "Bucks" },
{ name: "Chiltern",    auth: "Chiltern" },
```

The `auth` value is the PlanIt API `auth` parameter for that council.
Check available councils at: https://www.planit.org.uk/api/applics/json?help=1
