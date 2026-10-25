# Eduzyra Backend

Express + MongoDB API for the Eduzyra e-learning platform: Google Sign-In and password login, course/lesson catalog, enrollments, Razorpay payments + webhooks, certificates, coupons, live classes/sessions, feedback, and notifications.

## Stack

- Node.js 20 + Express 4
- MongoDB + Mongoose 8
- Auth: `jsonwebtoken` + `bcryptjs`, Google Sign-In via `google-auth-library` (ID-token flow)
- Payments: `razorpay` (orders + HMAC webhook verification)
- Uploads: `multer` → `sharp` → `cloudinary`
- Hardening: `helmet`, `express-rate-limit`, `express-mongo-sanitize`, `cors` allowlist, `zod` validation

## Quickstart

```bash
npm ci
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# Edit .env: MONGO_URI, JWT_SECRET, CLIENT_ORIGIN, Razorpay/Brevo/Cloudinary keys
# Optional: GOOGLE_CLIENT_ID enables "Continue with Google" (see Auth below)
npm run seed                # courses + coupons + demo admin (admin@eduzyra.dev / ChangeMe123!)
npm run dev                 # http://localhost:5000 (nodemon)
```

No local MongoDB? Run fully in-memory (seeds + serves, nothing to install):

```bash
npm run dev:mem
```

Health check: `GET /api/health` → `{ status: "ok", db: "connected", ... }`. Root `GET /` lists the route groups.

> Change the seeded demo admin password before deploying anywhere real.

## Environment

All vars are documented in [`.env.example`](.env.example). Never commit `.env` — only `.env.example` is tracked.

| Group | Key vars |
|---|---|
| Server | `PORT`, `NODE_ENV` (`development`/`production`/`test`), `LOG_LEVEL` |
| CORS | `CLIENT_ORIGIN` (comma-separated allowlist, e.g. `https://app.example.com,https://www.example.com`), `BACKEND_PUBLIC_URL` |
| DB | `MONGO_URI` |
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `COOKIE_SECRET` |
| Google Sign-In | `GOOGLE_CLIENT_ID` (Web client ID), optional `GOOGLE_ALLOWED_DOMAINS` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CURRENCY` |
| Email (Brevo REST API) | `BREVO_API_KEY`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` (verified sender), `ADMIN_EMAIL` — HTTPS API (port 443), works on Render free tier where SMTP ports are blocked |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` |

Generate secrets with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with nodemon (`server.js`) |
| `npm run dev:mem` | In-memory Mongo + seed + serve (no DB needed) |
| `npm start` | Production serve (`node server.js`) |
| `npm run start:prod` | PM2 cluster mode (`ecosystem.config.cjs`) |
| `npm run seed` | Seed courses, coupons, demo admin |
| `npm test` / `npm run test:cors` | CORS preflight smoke test (no DB) |
| `npm run test:live` | Live-session flow (mongodb-memory-server) |
| `npm run test:certificates` | Certificate issue/verify flow (mongodb-memory-server) |
| `npm run test:google` | Google Sign-In + password login flow (mongodb-memory-server) |
| `npm run migrate:cleanup-auth` | One-off: remove legacy OTP/password-reset data |
| `npm run diag:db` | Print cert/lesson/enrollment/course diagnostics |
| `npm run clean:courses` | **Destructive:** delete all courses + related records |

## API reference

Base path `/api`. Protected routes send `Authorization: Bearer <token>`.

### Auth — `/api/auth`
| Method | Route | Access |
|---|---|---|
| POST | `/login` | Public — `{ email, password }` (existing password accounts) |
| POST | `/google` | Public — `{ credential }` (Google ID token), creates or logs in the user |
| POST | `/logout` | Logged in |
| GET | `/me` | Logged in |
| PATCH | `/me` | Logged in — update profile |
| PATCH | `/me/avatar` | Logged in — avatar upload (multer+sharp+Cloudinary) |
| POST | `/contact` | Public — contact form (rate-limited, mails `ADMIN_EMAIL`) |
| GET | `/users`, `/stats` | Admin |

#### Google Sign-In

`POST /api/auth/google` accepts `{ "credential": "<Google ID token>" }` and returns
`{ user, token, isNewUser }` — the same JWT contract as `/login`. Google tokens are
verified server-side (signature, audience, issuer, expiry, `email_verified`); the
email is never taken from the request body.

- New email → creates a `student` account with no password and returns a JWT. This is
  the only signup path.
- Existing email → links `googleId` and logs the user in, preserving role, password,
  enrollments and password-login access.
- Existing Google account → idempotent login.
- Google accounts have no password until they set one via `PATCH /me` (no
  `currentPassword` needed until one exists).

Frontend setup (React + Vite): create an OAuth 2.0 **Web** client ID in Google Cloud
Console, add `http://localhost:5173` + production origins as authorized JavaScript
origins, set `VITE_GOOGLE_CLIENT_ID` to the same value as `GOOGLE_CLIENT_ID`, use
`@react-oauth/google`, and POST the returned `credential` to this endpoint. No client
secret or redirect URI is required. Use `GOOGLE_ALLOWED_DOMAINS` to restrict sign-ins
to specific domains; leave it empty to accept any verified Google account.

### Courses — `/api/courses`
| Method | Route | Access |
|---|---|---|
| GET | `/?category=&query=` | Public |
| GET | `/admin/all` | Admin |
| GET | `/mine` | Instructor/Admin — own courses |
| GET | `/:id` | Public — `:id` is the slug (e.g. `react-professional`) |
| POST | `/` | Instructor/Admin |
| PUT | `/:id` | Owning instructor/Admin |
| POST | `/:id/thumbnail` | Instructor/Admin — thumbnail upload |
| DELETE | `/:id` | Instructor/Admin |

### Lessons — `/api/lessons`
| Method | Route | Access |
|---|---|---|
| GET | `/?courseId=` | Public — lessons by course |
| GET | `/:id` | Logged in |
| GET | `/:id/answer` | Logged in — check answer |
| POST | `/:id/submit` | Logged in — assignment PDF upload |
| POST | `/` | Instructor/Admin — create |
| PUT | `/:id` | Instructor/Admin — update |
| POST | `/:id/attachment` | Instructor/Admin — PDF attachment |
| DELETE | `/:id` | Admin |

### Enrollments — `/api/enrollments`
| Method | Route | Access |
|---|---|---|
| GET | `/me` | Logged in — own enrollments (populated) |
| POST | `/` | Logged in — `{ courseId }` |
| PATCH | `/:id/progress` | Logged in — `{ progress }` 0–100 |

### Payments (Razorpay) — `/api/payments`
| Method | Route | Access |
|---|---|---|
| POST | `/webhook` | Public (HMAC-verified) — `payment.captured`, `payment.failed`, `refund.processed` |
| POST | `/order` | Logged in — `{ courseId, couponCode? }`, amount computed server-side |
| POST | `/verify` | Logged in — Razorpay signature verification |
| GET | `/me` | Logged in — order history |
| GET | `/all` | Admin |
| POST | `/:orderId/refund` | Admin |

> The webhook route uses `express.raw()` **before** the global `express.json()` so the HMAC signature matches the raw bytes.

### Certificates — `/api/certificates`
| Method | Route | Access |
|---|---|---|
| GET | `/mine` | Logged in |
| GET | `/admin/all` | Admin |
| GET | `/:id` | Public — verification page |
| POST | `/` | Logged in — `{ courseId }`, requires 100% progress |

### Coupons — `/api/coupons`
| Method | Route | Access |
|---|---|---|
| POST | `/apply` | Logged in — `{ code, courseId }` |
| GET | `/` | Admin |
| POST | `/` | Admin |
| DELETE | `/:id` | Admin |

### Live classes — `/api/live-classes`
| Method | Route | Access |
|---|---|---|
| GET | `/` | Public |
| GET | `/:id` | Logged in |
| POST | `/:id/join` / `/:id/leave` | Logged in |
| GET | `/:id/attendees` | Logged in |
| PATCH | `/:id/start` / `/:id/end` | Instructor/Admin |
| POST | `/` / PUT `/:id` | Instructor/Admin |
| DELETE | `/:id` | Admin |

### Live sessions — `/api/courses/:courseId/live-sessions` + `/api/live-sessions`
| Method | Route | Access |
|---|---|---|
| POST | `/api/courses/:courseId/live-sessions` | Instructor/Admin |
| GET | `/api/courses/:courseId/live-sessions` | Logged in |
| GET | `/api/live-sessions/:id` | Logged in |
| PATCH/DELETE | `/api/live-sessions/:id` | Instructor/Admin |
| POST | `/api/live-sessions/:id/join` | Logged in (rate-limited) |

### Feedback — `/api/feedback`
| Method | Route | Access |
|---|---|---|
| POST | `/` | Public (rate-limited) |
| GET | `/`, `/stats` | Admin |
| DELETE | `/:id` | Admin |

### Notifications — `/api/notifications`
| Method | Route | Access |
|---|---|---|
| GET | `/` | Logged in — own notifications |
| PATCH | `/read-all`, `/:id/read` | Logged in |
| DELETE | `/:id` | Logged in |

## Project structure

```
server.js                 # boot: connect DB, listen, graceful shutdown
src/app.js                # express app: helmet, rate limits, CORS, routes
src/config/               # db.js, cloudinary.js
src/models/               # User, Course, Lesson, Enrollment, Order, Certificate, …
src/controllers/          # request handlers per domain
src/routes/               # route definitions + zod validation + RBAC
src/middleware/           # auth (protect/requireRole), upload, errorHandler
src/services/             # emailService, …
src/validators/           # zod schemas
src/data/                 # coursesSeed.js, couponsSeed.js, seedRunner.js
src/utils/                # logger, ApiError, asyncHandler, …
scripts/                  # one-off ops: dev-mem, diag-db, migrations, cleanups
tests/                    # smoke tests (CORS, Google auth, live sessions, certificates)
docs/                     # feature notes (e.g. CERTIFICATE_TESTING.md)
```

## Deployment

- **Render / single container:** `npm ci --omit=dev && node server.js`. Set `NODE_ENV=production`, `CLIENT_ORIGIN=https://<frontend>`, `MONGO_URI`, `JWT_SECRET`, Razorpay/Brevo/Cloudinary vars. Health check path: `/api/health`. Email uses the Brevo HTTPS API (port 443), which works on the free tier where SMTP ports 25/465/587 are blocked — set `BREVO_API_KEY` + verified `EMAIL_FROM_ADDRESS`.
- **Docker:** `docker build -t eduzyra-backend . && docker run -p 5000:5000 --env-file .env eduzyra-backend`. Multi-stage build installs Sharp's `vips` deps; runs as non-root with a `HEALTHCHECK` on `/api/health`.
- **PM2 (VPS):** `npm run start:prod` (cluster, `ecosystem.config.cjs`). With `instances: max`, front with Redis if you raise rate limits — `express-rate-limit` MemoryStore is per-process.
- **Razorpay webhook:** expose `POST /api/payments/webhook`, paste the URL + secret into Dashboard → Settings → Webhooks, subscribe to `payment.captured`, `payment.failed`, `refund.processed`.

## Security notes

- CORS is an explicit allowlist from `CLIENT_ORIGIN`; requests without `Origin` (curl/Postman/server-to-server) are allowed, unknown origins get `Not allowed by CORS`.
- Auth endpoints are rate-limited; the contact form has a tighter limit.
- `express-mongo-sanitize` strips `$`/`.` operators; bodies validated with `zod`; uploads size- and type-limited.
- Never commit `.env`. See [SECURITY.md](SECURITY.md) for reporting and key-rotation guidance.

## Troubleshooting

### Sharp fails to install or import
Sharp needs a native `libvips` binary. Verify after install:

```bash
node -e "import('sharp').then(m => console.log('Sharp OK')).catch(e => { console.error(e.message); process.exit(1) })"
```

- Rebuild: `npm rebuild sharp`
- Docker: the provided `Dockerfile` already installs `vips-dev` (build stage) + `vips` (runtime) on Alpine.
- CI (Ubuntu): `sudo apt-get install -y libvips-dev` before `npm ci` (see `.github/workflows/ci.yml`).

## License

MIT — see [LICENSE](LICENSE).
