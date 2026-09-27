
export const COUPONS_SEED = [
  {
    code: 'WELCOME10',
    type: 'percentage',
    value: 10,
    label: '10% off for first-time learners',
    active: true,
    expiresAt: new Date('2026-12-31T23:59:59Z'),
  },
  {
    code: 'EARLYBIRD500',
    type: 'flat',
    value: 500,
    label: '₹500 off — early-bird offer',
    active: true,
    expiresAt: new Date('2026-09-30T23:59:59Z'),
  },
  {
    code: 'BATCH2026',
    type: 'percentage',
    value: 15,
    label: '15% off — 2026 batch offer',
    active: true,
    expiresAt: new Date('2026-10-15T23:59:59Z'),
  },
  {
    code: 'LAUNCH20',
    type: 'percentage',
    value: 20,
    label: '20% off — limited launch discount',
    active: true,
    expiresAt: new Date('2026-08-31T23:59:59Z'),
  },
  {
    code: 'STUDENT1000',
    type: 'flat',
    value: 1000,
    label: '₹1,000 off for verified students',
    active: false,
    expiresAt: new Date('2026-11-30T23:59:59Z'),
  },
]
