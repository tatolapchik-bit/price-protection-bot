# Deployment Guide: GitHub + Render + Netlify

## Quick Start (5-10 minutes)

### Step 1: Push to GitHub

```bash
# In the project folder, commit and push
cd price-protection-bot
git add -A
git commit -m "Initial commit: PriceProtectionBot SaaS"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/price-protection-bot.git
git branch -M main
git push -u origin main
```

Or use GitHub Desktop / VS Code to push.

---

### Step 2: Deploy Backend on Render

1. Go to [render.com](https://render.com) and sign up/login
2. Click **New +** → **Blueprint**
3. Connect your GitHub repo
4. Render will detect `render.yaml` and create:
   - PostgreSQL database (free)
   - Web service for API (free)
   - Worker for background jobs (free)

5. **Set Environment Variables** in Render dashboard:

   | Variable | Where to get it |
   |----------|-----------------|
   | `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
   | `GOOGLE_CLIENT_SECRET` | Same as above |
   | `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) |
   | `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → Add endpoint |
   | `SENDGRID_API_KEY` | [SendGrid](https://app.sendgrid.com/settings/api_keys) |
   | `FRONTEND_URL` | Your Netlify URL (after step 3) |

6. **For Redis** (required for job queues):
   - Free option: [Upstash](https://upstash.com) - create free Redis, copy URL
   - Set `REDIS_URL` in Render to your Upstash connection string

7. Note your Render backend URL: `https://priceprotectionbot-api.onrender.com`

---

### Step 3: Deploy Frontend on Netlify

1. Go to [netlify.com](https://netlify.com) and sign up/login
2. Click **Add new site** → **Import an existing project**
3. Connect GitHub and select your repo
4. Configure build settings:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/dist`

5. **Set Environment Variables** in Netlify:

   | Variable | Value |
   |----------|-------|
   | `VITE_STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key (pk_...) |
   | `VITE_GOOGLE_CLIENT_ID` | Your Google OAuth client ID |

6. **Update API Proxy** (important!):
   - Edit `frontend/netlify.toml` and `frontend/_redirects`
   - Replace `priceprotectionbot-api.onrender.com` with your actual Render URL

7. Redeploy after updating the proxy URL

---

### Step 4: Configure OAuth & Webhooks

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add Authorized redirect URIs:
   - `https://your-app.netlify.app/auth/callback`
   - `https://priceprotectionbot-api.onrender.com/api/auth/google/callback`

#### Stripe Webhooks
1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://priceprotectionbot-api.onrender.com/api/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy webhook secret → Set `STRIPE_WEBHOOK_SECRET` in Render

---

## Verify Deployment

1. Visit your Netlify URL
2. You should see the landing page
3. Click "Get Started" to test registration
4. Connect Gmail and add a test purchase
5. Check Render logs for any errors

---

## Estimated Costs (Free Tier)

| Service | Plan | Limit |
|---------|------|-------|
| Render Web | Free | 750 hrs/month, sleeps after 15min |
| Render Postgres | Free | 256MB storage |
| Upstash Redis | Free | 10K commands/day |
| Netlify | Free | 100GB bandwidth/month |
| SendGrid | Free | 100 emails/day |
| Stripe | Pay as you go | 2.9% + $0.30 per transaction |

**Total: $0/month** for development and light production use.

---

## Upgrading for Production

For production traffic, consider:

1. **Render**: Upgrade to Starter ($7/month) - no sleep, better performance
2. **Database**: Upgrade to Starter ($7/month) - 1GB storage
3. **Redis**: Upstash Pro or Render Redis ($10/month)
4. **Custom Domain**: Add in Netlify (free) and Render (free on paid plans)

---

## Troubleshooting

### API calls failing?
- Check Render logs for errors
- Verify `FRONTEND_URL` is set correctly
- Check CORS settings in backend

### OAuth not working?
- Verify redirect URIs in Google Console match exactly
- Check browser console for errors

### Emails not sending?
- Verify SendGrid API key
- Check sender verification in SendGrid

### Prices not updating?
- Check worker logs in Render
- Verify Redis connection
- Some sites block scraping - check priceMonitor.js logs
