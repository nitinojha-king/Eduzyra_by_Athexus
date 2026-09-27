# Eduzyra Backend (partial — core modules)

A Node.js/Express + MongoDB API for the [Eduzyra by Althexus](../eduzyra-althexus) frontend.
This is **not the full backend** — it covers the core ~40% of the platform (auth, courses,
enrollment, mock payments, certificates, coupons) so the frontend's existing `services/`
files can be pointed at real endpoints instead of static/in-memory mocks. See
["What's built vs. what's left"](#whats-built-vs-whats-left) below.

## Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT auth (`jsonwebtoken`) + `bcryptjs` for password hashing
- Plain `express.json()` — no ORM magic, no framework beyond Express

## Getting started

```bash
cd eduzyra-backend
npm install
cp .env.example .env     # then edit MONGO_URI / JWT_SECRET
npm run seed              # loads the course catalog + coupons ported from the frontend
npm run dev                # http://localhost:5000, requires nodemon (already in devDependencies)
```

You need a MongoDB instance — either local (`mongodb://127.0.0.1:27017/eduzyra`) or a free
[MongoDB Atlas](https://www.mongodb.com/atlas) cluster. Put its connection string in `.env`.

`npm run seed` also creates a demo admin account: `admin@eduzyra.dev` / `ChangeMe123!` —
**change this password before deploying anywhere real.**

## What's built vs. what's left

| Module | Status | Notes |
|---|---|---|
| Auth (signup/login/JWT) | ✅ Built | Signup always creates a `student`, matching the frontend's current behavior |
| Forgot/reset password | ✅ Built (partial) | Generates a real reset token; does not *email* it yet — the token is returned directly in the API response so the flow is testable. Wire up a mail provider before shipping. |
| Course catalog (list/detail) | ✅ Built | Seeded from the frontend's existing `constants/courses.js` data |
| Course create/update/delete | ✅ Built | Instructor/admin only — not yet exposed in the frontend's Instructor/Admin dashboards (those still read `constants/adminData.js`) |
| Enrollment | ✅ Built | Enroll, list "my courses", update lesson progress |
| Payments | ✅ Built (mock) | Same demo behavior as `paymentService.js` (card ending `0000` fails) — **this is still not a real payment gateway.** Swap `paymentController.js` for Razorpay/Stripe server-side verification before going live. |
| Coupons | ✅ Built | Validates server-side against real course prices instead of trusting a client-sent amount |
| Certificates | ✅ Built | Issue (requires 100% progress) + public verification by ID |
| Instructor dashboard data (real analytics) | ❌ Not built | Frontend still uses `constants/adminData.js` |
| Admin dashboard data (students/payments/revenue tables) | ❌ Not built | Same as above |
| Email sending (welcome, payment confirmation, reset link) | ❌ Not built | No mail provider connected |
| Live classes, discussion forums, AI assistant, job board | ❌ Out of scope | Called out as out-of-scope in the frontend README too |

## API reference

All routes are prefixed `/api`. Protected routes expect `Authorization: Bearer <token>`.

### Auth — `/api/auth`
| Method | Route | Access | Body |
|---|---|---|---|
| POST | `/signup` | Public | `{ name, email, password }` |
| POST | `/login` | Public | `{ email, password }` |
| GET | `/me` | Logged in | — |
| POST | `/forgot-password` | Public | `{ email }` |
| POST | `/reset-password` | Public | `{ token, password }` |

### Courses — `/api/courses`
| Method | Route | Access | Notes |
|---|---|---|---|
| GET | `/?category=&query=` | Public | Matches `courseService.fetchCourses()` |
| GET | `/:id` | Public | `:id` is the slug, e.g. `react-professional` |
| POST | `/` | Instructor/Admin | Create a course |
| PUT | `/:id` | Owning instructor/Admin | Update a course |
| DELETE | `/:id` | Admin | Delete a course |

### Enrollments — `/api/enrollments` (all require login)
| Method | Route | Notes |
|---|---|---|
| GET | `/me` | Student's enrolled courses (populated) |
| POST | `/` | `{ courseId }` — enroll |
| PATCH | `/:id/progress` | `{ progress }` (0–100), used by the lesson player |

### Payments — `/api/payments` (all require login)
| Method | Route | Notes |
|---|---|---|
| POST | `/order` | `{ courseId, couponCode? }` → creates an order server-side, amount is never trusted from the client |
| POST | `/verify` | `{ orderId, cardNumber }` — mock verification, matches `paymentService.processPayment()` |
| GET | `/me` | Order history |

### Certificates — `/api/certificates`
| Method | Route | Access | Notes |
|---|---|---|---|
| GET | `/:id` | Public | Matches `VerifyCertificate.jsx` / `Certificate.jsx` |
| POST | `/` | Logged in | `{ courseId }` — requires 100% progress on that course |

### Coupons — `/api/coupons`
| Method | Route | Access |
|---|---|---|
| POST | `/apply` | Logged in — `{ code, courseId }` |
| GET | `/` | Admin |
| POST | `/` | Admin |

## Wiring this into the frontend

Per the frontend's own README ("What's mocked and where to plug in a real backend"),
only `src/services/*.js` and `src/context/AuthContext.jsx` need to change — no component
should need edits. Point each service's functions at `fetch(`${API_URL}/...`)` calls against
the routes above, store the JWT (e.g. in memory + `localStorage`), and send it as
`Authorization: Bearer <token>` on protected requests.

## Troubleshooting

### Sharp fails to install or import

Sharp is a native image processing library used for compressing avatars and course
thumbnails before uploading to Cloudinary. On some systems (especially Alpine Linux
or CI environments), the prebuilt binary may not match your platform.

**After `npm install`, verify Sharp works:**

```bash
node -e "import('sharp').then(m => console.log('Sharp version:', m.default.versions.sharp)).catch(e => console.error('Sharp failed:', e.message))"
```

If it throws, rebuild Sharp from source:

```bash
npm rebuild sharp
```

If that also fails, try installing with the `--platform` flag:

```bash
npm install sharp --platform=linux --arch=x64
```

In Docker (Alpine), add this to your Dockerfile before `npm ci`:

```dockerfile
RUN apk add --no-cache python3 make g++ vips-dev
```
