# CHTA Booth Direct Booking Audit App v4

This app runs a public QR-friendly website audit for CHTA prospects. It generates a two-page report with a Direct Booking Readiness score, five category score cards, top issues, quick fixes, and a detailed breakdown.

## What changed in v4
- Restores Direct Booking Readiness as a weighted score from five visible category scores.
- Removes source/vendor wording from the generated report pages.
- Removes the 20-minute meeting CTA box from the PDF/report.
- Fixes footer spacing so it does not overlap page content.
- Keeps the report layout HTML/CSS-based to reduce overlap and alignment issues.

## Setup
Use the commands provided in ChatGPT. Add your API key in `.env`:

```env
PORT=3000
PAGESPEED_API_KEY=your_key_here
APP_TITLE=CHTA Direct Booking Website Audit
```

Run:

```powershell
node server.js
```

Then open:

```text
http://localhost:3000
```
