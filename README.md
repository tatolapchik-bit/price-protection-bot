# PriceProtectionBot

**Automatic Price Protection Claim Filing**

Monitor your purchases, detect price drops, and file credit card price protection claims automatically. Recover hundreds of dollars that you're already entitled to.

## 🎯 The Problem

Credit card price protection is a benefit that most cards offer - if an item you purchased drops in price within a certain window (typically 60-120 days), your card issuer will refund the difference. But **less than 1% of cardholders ever use this benefit** because:

- Manually tracking prices is tedious
- Filing claims requires gathering documentation
- Most people forget about purchases after a few weeks

## 💡 The Solution

PriceProtectionBot automates the entire process:

1. **Automatic Purchase Detection** - Connect your Gmail and we detect purchases from order confirmation emails
2. **Price Monitoring** - We check prices multiple times daily across major retailers
3. **Claim Preparation** - When prices drop, we generate all the documentation you need
4. **Filing Assistance** - Step-by-step instructions for each card issuer

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                      │
│   Dashboard │ Purchases │ Claims │ Cards │ Settings       │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend API (Node.js)                   │
│   Auth │ Purchases │ Claims │ Cards │ Subscriptions       │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Gmail API    │    │ Price        │    │ Stripe       │
│ Email Parser │    │ Scraper      │    │ Billing      │
└──────────────┘    └──────────────┘    └──────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
                    ┌──────────────────┐
                    │   PostgreSQL     │
                    │   + Redis        │
                    └──────────────────┘
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis (for job queues)
- Google Cloud Console account (for Gmail API)
- Stripe account (for payments)

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# - DATABASE_URL
# - GOOGLE_CLIENT_ID/SECRET
# - STRIPE_SECRET_KEY
# - etc.

# Run database migrations
npx prisma migrate dev

# Seed initial data (optional)
npm run seed

# Start the server
npm run dev
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Variables

#### Backend (.env)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection URL |
| `JWT_SECRET` | Secret for JWT tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Stripe price ID for subscription |
| `SENDGRID_API_KEY` | SendGrid API key for emails |
| `FRONTEND_URL` | Frontend URL for redirects |

## 📁 Project Structure

```
price-protection-bot/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma      # Database schema
│   ├── src/
│   │   ├── index.js           # Express app entry
│   │   ├── routes/            # API routes
│   │   │   ├── auth.js
│   │   │   ├── purchases.js
│   │   │   ├── claims.js
│   │   │   ├── cards.js
│   │   │   └── ...
│   │   ├── services/          # Business logic
│   │   │   ├── emailParser.js
│   │   │   ├── priceMonitor.js
│   │   │   ├── claimService.js
│   │   │   └── notificationService.js
│   │   ├── middleware/        # Auth, error handling
│   │   ├── utils/             # Helpers
│   │   └── workers/           # Cron jobs
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/        # Reusable UI
│   │   ├── pages/             # Route pages
│   │   ├── context/           # React context
│   │   ├── services/          # API client
│   │   └── styles/            # CSS
│   └── package.json
└── README.md
```

## 🔑 Key Features

### Email Integration
- OAuth2 Gmail connection
- Automatic parsing of order confirmation emails
- Support for 50+ major retailers

### Price Monitoring
- Web scraping with Puppeteer
- API integrations where available (Keepa)
- Rate-limited to respect retailers
- Cron-based scheduling

### Claim Management
- PDF documentation generation
- Card-issuer specific instructions
- Claim status tracking
- Deadline reminders

### Subscription Billing
- Stripe integration
- $15/month pricing
- Customer portal for management
- Webhook handling

## 🛠️ Development

### Running Tests

```bash
cd backend
npm test
```

### Database Management

```bash
# Create migration
npx prisma migrate dev --name description

# Reset database
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

### Adding a New Retailer

1. Add pattern to `backend/src/services/emailParser.js`:
```javascript
newretailer: {
  fromPatterns: ['orders@newretailer.com'],
  subjectPatterns: ['Your order'],
  priceRegex: /\$[\d,]+\.\d{2}/g,
  orderIdRegex: /Order[#:\s]*(\d+)/i,
  domain: 'newretailer.com'
}
```

2. Add price selectors to `backend/src/services/priceMonitor.js`:
```javascript
'newretailer.com': [
  '.price-selector',
  '[data-price]'
]
```

## 🚢 Deployment

### Docker (Recommended)

```bash
docker-compose up -d
```

### Manual Deployment

1. Set up PostgreSQL and Redis
2. Configure environment variables
3. Build frontend: `npm run build`
4. Start backend: `npm start`
5. Serve frontend with nginx/CDN

### Stripe Webhook

Configure your Stripe webhook endpoint:
```
https://your-domain.com/api/webhooks/stripe
```

Events to listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

## 📊 Business Model

- **Free tier**: Manual purchase tracking only
- **Pro ($15/month)**: Full automation, email scanning, claim generation
- **Target**: 33x ROI for users (avg $500 savings/year)

## 📝 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

Built with ❤️ to help people recover money they're already owed.
