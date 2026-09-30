# Eduzyra Backend

Express + MongoDB API for the Eduzyra e-learning platform: JWT auth with email-OTP verification, course/lesson catalog, enrollments, Razorpay payments + webhooks, certificates, coupons, live classes/sessions, feedback, and notifications.

## Stack

- Node.js 20 + Express 4
- MongoDB + Mongoose 8
- Auth: `jsonwebtoken` + `bcryptjs`, email OTP via `nodemailer`
- Payments: `razorpay` (orders + HMAC webhook verification)
- Uploads: `multer` → `sharp` → `cloudinary`
- Hardening: `helmet`, `express-rate-limit`, `express-mongo-sanitize`, `cors` allowlist, `zod` validation

## Quickstart

```bash
npm ci
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# Edit .env: MONGO_URI, JWT_SECRET, CLIENT_ORIGIN, Razorpay/SMTP/Cloudinary keys
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
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `COOKIE_SECRET`, `RESET_TOKEN_TTL_MINUTES`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` |
| OTP | `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CURRENCY` |
| Email (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`, `ADMIN_EMAIL` |
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
| `npm run migrate:verify-users` | One-off: mark pre-OTP users verified |
| `npm run diag:db` | Print cert/lesson/enrollment/course diagnostics |
| `npm run clean:courses` | **Destructive:** delete all courses + related records |

## API reference

Base path `/api`. Protected routes send `Authorization: Bearer <token>`.

### Auth — `/api/auth`
| Method | Route | Access |
|---|---|---|
| POST | `/signup` | Public — `{ name, email, password }`, sends OTP |
| POST | `/verify-otp` | Public — `{ email, otp }` |
| POST | `/resend-otp` | Public — `{ email }` (rate-limited) |
| POST | `/login` | Public — `{ email, password }` |
| POST | `/logout` | Logged in |
| GET | `/me` | Logged in |
| PATCH | `/me` | Logged in — update profile |
| PATCH | `/me/avatar` | Logged in — avatar upload (multer+sharp+Cloudinary) |
| POST | `/forgot-password` | Public — `{ email }` |
| POST | `/reset-password` | Public — `{ token, password }` |
| POST | `/contact` | Public — contact form (rate-limited, mails `ADMIN_EMAIL`) |
| GET | `/users`, `/stats` | Admin |

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
src/utils/                # logger, ApiError, asyncHandler, otp, …
scripts/                  # one-off ops: dev-mem, diag-db, migrations, cleanups
tests/                    # smoke tests (CORS, live sessions, certificates)
docs/                     # feature notes (e.g. CERTIFICATE_TESTING.md)
```

## Deployment

- **Render / single container:** `npm ci --omit=dev && node server.js`. Set `NODE_ENV=production`, `CLIENT_ORIGIN=https://<frontend>`, `MONGO_URI`, `JWT_SECRET`, Razorpay/SMTP/Cloudinary vars. Health check path: `/api/health`.
- **Docker:** `docker build -t eduzyra-backend . && docker run -p 5000:5000 --env-file .env eduzyra-backend`. Multi-stage build installs Sharp's `vips` deps; runs as non-root with a `HEALTHCHECK` on `/api/health`.
- **PM2 (VPS):** `npm run start:prod` (cluster, `ecosystem.config.cjs`). With `instances: max`, front with Redis if you raise rate limits — `express-rate-limit` MemoryStore is per-process.
- **Razorpay webhook:** expose `POST /api/payments/webhook`, paste the URL + secret into Dashboard → Settings → Webhooks, subscribe to `payment.captured`, `payment.failed`, `refund.processed`.

## Security notes

- CORS is an explicit allowlist from `CLIENT_ORIGIN`; requests without `Origin` (curl/Postman/server-to-server) are allowed, unknown origins get `Not allowed by CORS`.
- Auth endpoints are rate-limited; OTP resend/verify and contact form have tighter limits.
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
