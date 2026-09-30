# Pull requests

## What changed?


## Why?


## How to test?
- [ ] `npm ci`
- [ ] `npm run test:cors`
- [ ] `npm run test:live`
- [ ] `npm run test:certificates`
- [ ] Manual: `npm run seed` then `npm run dev`, check `GET /api/health`

## Checklist
- [ ] No secrets committed (`.env` untouched, only `.env.example` updated if needed)
- [ ] `.env.example` updated if a new env var was added
- [ ] README updated if routes / setup changed
