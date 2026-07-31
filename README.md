# 3DNow Student 3D Print Quote Engine

A standalone Vite and Express application for trustworthy student 3D-print package quotes. It separates early mesh analysis from verified sliced metrics and keeps pricing on the server.

## Install and run

Requires Node.js 20 or later and the `prusa-slicer` CLI for STL, OBJ, and unsliced 3MF slicing.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The marketing site is the homepage and its Quote engine links open `http://localhost:3000/quote-engine`. For production:

```bash
npm run build
npm start
```

## Admin email notifications

Copy `.env.example` to `.env` and add the SMTP credentials from your mail provider. The app loads this file for `npm run dev` and `npm start`.

Every quote-engine upload and quote result sends an operational notification to `NOTIFY_TO`. A paid student order sends the final order notification to the admin and payment confirmation to the customer. Files up to 20 MB are attached. Larger files remain in private server storage and are identified in the notification for secure retrieval.

Never commit `.env` or SMTP credentials.

## Operations dashboard

Set `ADMIN_PASSWORD` in `.env`, then open:

```text
http://localhost:3000/admin
```

The dashboard stores every inbound request (student checkouts, business/private quotes, contact and design forms) in `server/data/orders.json`. From there you can:

- browse and filter the inbox
- open request details and download uploaded files
- move orders through production statuses
- email the customer when a status changes (completed, shipped, ready for pickup, and more)

Production statuses: new, reviewing, quoted, awaiting-payment, paid, in-production, completed, shipped, ready-pickup, cancelled.

## Stripe payment checkout

Student orders use Stripe Checkout after a verified quote and school-email or student-ID verification. Stripe collects the shipping and billing addresses, then the Stripe webhook sends the final customer and admin emails after the payment succeeds.

Set `PUBLIC_URL` to the public application URL, then configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`. Register the webhook endpoint:

```text
https://your-domain.example/api/payments/webhook
```

Subscribe it to `checkout.session.completed`. For local testing with the Stripe CLI:

```bash
stripe listen --forward-to http://localhost:3000/api/payments/webhook
```

Copy the reported `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. Never add Stripe keys or webhook secrets to git.

## Self-contained application runtime

For automatic server-side slicing with no host PrusaSlicer installation, run the packaged application with Docker Desktop or Docker Engine:

```bash
npm run app
```

This builds the application image, installs the `prusa-slicer` CLI inside that image, and starts the full application at `http://localhost:3000`. STL, OBJ, and unsliced 3MF files then slice automatically after upload. The host only needs Docker, not Node.js or PrusaSlicer. Uploaded files and generated G-code use named Docker volumes and are not public web assets.

## PrusaSlicer

Slicing always runs in CLI mode (no GUI). On macOS, `npm run dev` auto-detects a local install at `/Applications/PrusaSlicer.app` or `/Applications/Original Prusa Drivers/PrusaSlicer.app`. It also accepts `prusa-slicer` / `PrusaSlicer` on `PATH`, or an explicit `PRUSA_SLICER_PATH`.

The Docker runtime (`npm run app`) still installs the CLI inside the image for machines without a local slicer. Profiles are in `server/slicer-profiles/{printer,print,filament}`. Default STL/OBJ/mesh-3MF slice settings are 0.30 mm layer height, 0.6 mm nozzle, 15% grid infill, 2 walls, PLA filament.

Environment variables: `PORT` (default 3000), `PUBLIC_URL`, `PRUSA_SLICER_PATH`, `SLICE_TIMEOUT_MS` (default 600000), `SLICE_THREADS` (default 4), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `NOTIFY_TO`, `EMAIL_ATTACHMENT_LIMIT_BYTES`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.

## Supported files and validity

Instant quotes use sliced metadata from G-code, GCO, NC, and 3MF files with embedded G-code. STL, OBJ, and mesh-only 3MF uploads are sliced automatically when the server slicer is available (Docker image or host PrusaSlicer). Exact automatic pricing is produced only when both weight and time are present in trusted G-code headers. Missing metadata is manual review, never an estimate.

Uploads are capped at 100 MB. 3MF archives have entry, path, and decompression limits. Output directories are not web-served.

## Commands

`npm test` runs Node built-in tests. `npm run build` creates `dist`. `npm run dev` rebuilds the quote engine when source files change and serves the full site at port 3000. `npm start` serves the built site and API.

## Troubleshooting and limitations

If the health endpoint reports `slicerAvailable: false`, the quote UI warns early for unsliced uploads. Already sliced files still quote while unsliced models go to manual review. The initial in-memory job store resets after restart. 3MF mesh preview depends on Three.js loader support, and the server treats embedded G-code as bounded text without executing it.
