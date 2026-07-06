# Catcher.AI — Codebase Steering Document

## 1. Current Tech Stack

### Frontend
- **Framework**: None (vanilla HTML/CSS/JavaScript)
- **Styling**: Inline `<style>` blocks in each HTML file, CSS custom properties (variables)
- **UI Design**: Dark theme with green accent (`#22c55e` / `#31a668`), modern SaaS aesthetic
- **Fonts**: Inter (landing page), Plus Jakarta Sans (app & paywall)
- **Icons**: Tabler Icons via CDN webfont (`@tabler/icons-webfont`)
- **PDF Parsing**: pdf.js via CDN (`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174`)
- **State Management**: Plain JavaScript object (`S`) with manual `render()` calls
- **Data Persistence**: `localStorage` only — no server-side storage

### Backend
- **None exists** — There is no server, no `package.json`, no build tools
- **AI Integration**: Direct browser-to-API calls to Claude (`claude-sonnet-4-5`) using the `anthropic-dangerous-direct-browser-access` header
- **Mail Integration**: Direct browser-to-API calls to Mailform (`api.mailform.io`)
- **Payment Integration**: Stripe Checkout links (external redirect, no webhook handling)

### Hosting
- **No hosting configured** — Static files only, no deployment pipeline
- **Suitable for**: Any static host (GitHub Pages, Netlify, Vercel, S3+CloudFront)
- **Would need server for**: Secure API proxying, auth, webhooks, database

### External APIs Used
| Service | Purpose | Key Location | Security Risk |
|---------|---------|--------------|---------------|
| Anthropic Claude | AI credit report analysis & letter generation | localStorage (`cai_key`) | HIGH — exposed in browser |
| Mailform | USPS Certified Mail sending | localStorage (`cai_mf_key`) | HIGH — exposed in browser |
| Stripe | Payment/subscription checkout | Hardcoded in `paywall.html` | LOW — public key is expected |

### Security Concerns (Critical)
- Claude API key (`sk-ant-api03-...`) is stored in localStorage and sent directly from browser
- Mailform bearer token stored in localStorage and used client-side
- No authentication — anyone with the URL can access the app
- `localStorage.setItem('subscriptionActive', 'true')` or `app.html?subscription=active` bypasses paywall
- No CSRF, no rate limiting, no input sanitization

---

## 2. File/Folder Structure

```
catcher.ai/
├── .git/                    # Git repository
├── index.html               # Marketing landing page (~900 lines)
├── paywall.html             # Subscription/payment page (~280 lines)
├── app.html                 # Main application (~700 lines, all-in-one SPA)
└── docs/                    # Documentation (this file)
    └── STEERING.md
```

### Conventions Observed
- **Single-file architecture**: Each page is a self-contained HTML file with embedded CSS and JS
- **No shared code**: CSS variables, styles, and logic duplicated across files
- **Inline everything**: No external CSS files, no JS modules, no build step
- **Base64 logo**: The logo image is embedded as a massive base64 PNG data URI (~50KB+ each occurrence)
- **Navigation**: Simple `<a href="app.html">` links between pages (no router)
- **App routing**: Hash-free SPA pattern using a `view` state variable and manual DOM rendering

---

## 3. Current Data Models

All data is stored in `localStorage` as JSON strings. There is **no database schema** — these are implicit models derived from the JavaScript code in `app.html`.

### User Profile (`cai_prof`)
```json
{
  "name": "string",
  "address": "string", 
  "city": "string",
  "state": "string (2-letter)",
  "zip": "string",
  "ssn4": "string (last 4 digits)",
  "phone": "string",
  "email": "string"
}
```

### Credit Report (`cai_report`)
```json
{
  "name": "string (filename)",
  "text": "string (extracted text, max 50000 chars)"
}
```

### AI Analysis Result (`cai_analysis`)
```json
{
  "summary": "string (2-3 sentence overview)",
  "items": [
    {
      "creditor": "string",
      "title": "string",
      "description": "string",
      "bureau": "Equifax|Experian|TransUnion|All",
      "severity": "high|medium|low",
      "disputable": "boolean",
      "fcra_violation": "boolean",
      "law": "string (optional, FCRA section reference)"
    }
  ]
}
```

### Dispute (`cai_disputes` array)
```json
{
  "id": "string (D + timestamp)",
  "creditor": "string",
  "bureau": "string (Equifax|Experian|TransUnion)",
  "account": "string (optional)",
  "amount": "string (optional)",
  "issue": "string (description of the problem)",
  "law": "string (optional, FCRA law reference)",
  "status": "pending|resolved|sent|escalated",
  "created": "string (ISO 8601 date)"
}
```

### Letter (`cai_letters` array)
```json
{
  "id": "string (L + timestamp)",
  "dispId": "string (single dispute ID, optional)",
  "dispIds": ["string (array of dispute IDs, for grouped letters)"],
  "creditor": "string",
  "bureau": "string",
  "round": "number (1|2|3)",
  "text": "string (full letter content)",
  "created": "string (ISO 8601 date)",
  "mailed": "boolean",
  "trackingId": "string (optional, Mailform order ID)",
  "mailedAt": "string (optional, ISO 8601 date)"
}
```

### Score History (`cai_scores` array)
```json
{
  "score": "number (300-850)",
  "date": "string (ISO 8601 date)"
}
```

### Custom Mailing Address (`cai_caddr`)
```json
{
  "name": "string",
  "street": "string",
  "city": "string",
  "state": "string",
  "zip": "string"
}
```

### Bureau Addresses (hardcoded constants)
```javascript
{
  "Equifax": { name: "Equifax Information Services LLC", street: "P.O. Box 740256", city: "Atlanta", state: "GA", zip: "30374" },
  "Experian": { name: "Experian", street: "P.O. Box 4500", city: "Allen", state: "TX", zip: "75013" },
  "TransUnion": { name: "TransUnion LLC Consumer Dispute Center", street: "P.O. Box 2000", city: "Chester", state: "PA", zip: "19016" }
}
```

---

## 4. Auth & Payment Code

### Authentication
- **No authentication system exists**
- No user accounts, no sessions, no tokens
- The app is entirely client-side — anyone with the URL has full access
- There is a trivial "subscription check" that can be bypassed:
  ```javascript
  // In paywall.html — subscription bypass via URL param or localStorage
  localStorage.setItem('subscriptionActive', 'true')
  // or navigate to: app.html?subscription=active
  ```
- No actual subscription verification against Stripe

### Payment / Stripe Integration
- **Stripe Public Key**: `pk_live_...` (referenced in landing page meta, not actively used in code)
- **Stripe Checkout Link**: `https://buy.stripe.com/4gMbJ184H2ODfJr34F3AY00` (hardcoded in paywall.html)
- **Pricing**: $19.99/month with 7-day free trial, or $15.99/month annual ($191.88/year)
- **Price ID**: `price_1RN...` (referenced in comments)
- **Implementation**: Simple redirect to Stripe Checkout — no webhook, no subscription verification
- **Promo Codes**: Client-side only (LAUNCH50, LAUNCH25, FRIEND20, VIP, BETA, FIRSTFREE, GIFT10) — easily bypassable

### What's Missing for Production Auth/Payment
1. Server-side Stripe webhook handler to verify subscription status
2. User registration and login system (email/password or OAuth)
3. JWT or session-based authentication
4. Subscription status check on every app page load
5. Secure storage of API keys (Claude, Mailform) on server
6. Rate limiting and abuse prevention
7. Data encryption for sensitive PII (SSN, addresses)

---

## 5. Recommended Architecture for Backend

```
catcher.ai/
├── public/                   # Static frontend files
│   ├── index.html
│   ├── paywall.html
│   ├── app.html
│   ├── css/
│   │   └── shared.css       # Extracted shared styles
│   └── js/
│       └── app.js           # Extracted app logic
├── server/
│   ├── index.js             # Express server entry
│   ├── routes/
│   │   ├── auth.js          # Register, login, session
│   │   ├── analyze.js       # Proxy to Claude API
│   │   ├── disputes.js      # CRUD for disputes
│   │   ├── letters.js       # Generate & manage letters
│   │   ├── mail.js          # Proxy to Mailform API
│   │   └── stripe.js        # Webhook + subscription check
│   ├── middleware/
│   │   ├── auth.js          # JWT verification
│   │   └── rateLimit.js     # Rate limiting
│   ├── models/
│   │   ├── User.js
│   │   ├── Dispute.js
│   │   ├── Letter.js
│   │   └── Score.js
│   └── db/
│       └── schema.sql       # SQLite schema
├── .env.example             # Environment variable template
├── package.json
└── docs/
    └── STEERING.md
```

### Recommended Tech Choices
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: SQLite (via `better-sqlite3`) — simple, no external service needed
- **Auth**: JWT tokens with bcrypt password hashing
- **AI Proxy**: Server-side Claude API calls (keeps key secure)
- **Mail Proxy**: Server-side Mailform API calls (keeps key secure)
- **Payments**: Stripe webhooks for subscription verification
