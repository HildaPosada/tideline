# Tideline

A calm, wall-mounted family calendar dashboard, built for an old iPad stuck on iOS 12.

Designed with a Tulum-inspired wellness palette: warm sand, deep ocean teal, and clay terracotta. Events from two Google Calendars sit along a single "tideline" rather than stacked boxes, color-coded by person.

![Tideline dashboard](docs/screenshot.png)

## Why this exists

Modern family calendar apps (Skylight, Cozi, FamilyWall) all dropped support for iOS 12, which is the ceiling for older iPads like the iPad mini 2. This project sidesteps the App Store entirely: it's a static web page that runs in Safari, so it works on any iPad regardless of how old, and locks into a wall-display kiosk mode using Guided Access.

## How it works

- A Vercel serverless function (`/api/events`) fetches both calendars' secret iCal feeds server-side, expands recurring events, and merges them into one sorted list. Calendar URLs stay in environment variables, never exposed to the browser.
- The frontend polls that endpoint every 5 minutes and renders a static, glanceable agenda for the next several days.
- No build step, no framework, no client-side dependencies. Built to run smoothly on a decade-old Safari engine.

## Setup

1. Get each calendar's secret iCal URL: Google Calendar → Settings → select calendar → "Integrate calendar" → **Secret address in iCal format**.
2. Deploy to Vercel and set these environment variables:
   - `CAL_HP_URL` — your secret iCal feed
   - `CAL_KIM_URL` — partner's secret iCal feed
   - `CAL_HP_LABEL` (optional, defaults to "Hp")
   - `CAL_KIM_LABEL` (optional, defaults to "Kim")
3. On the iPad: open the deployed URL in Safari, add to Home Screen, then enable Guided Access (Settings → Accessibility → Guided Access) and triple-click the home button to lock it into kiosk mode.

## Local development

```bash
npm install
vercel dev
```

## Stack

Vanilla HTML/CSS/JS frontend, single Vercel serverless function (Node), `node-ical` for feed parsing. No frontend framework — intentional, for maximum compatibility with old Safari versions.
