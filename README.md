# Ledger — Expense Tracker

A modern multi-user expense tracking app with admin-controlled edits, built on **React + Vite + Firebase**.
Runs on Firebase's **free Spark plan — no credit card required**.

## Features

- **Login** via email/password OR phone number (India +91, OTP-based)
- **Sign up** via email (Name + Email mandatory)
- **3 tabs after login:**
  - **Update Details** — anyone can add transactions
  - **Dashboard** — total across years, year filter, monthly chart, per-user totals
  - **Transaction Details** — full table with proof viewer & download
- **Admins** (`Chandan10106@gmail.com`, `chandan06babu@gmail.com`) — only ones who can edit/delete
- **Proofs** (images / PDFs) stored as base64 directly in Firestore — no separate storage service needed
- **Multi-user** real-time access via Firebase
- **Cost: ₹0/month** on Spark free plan

## Permission Model

| Action | Anyone signed in | Admin only |
|---|---|---|
| Sign up / log in | ✅ | |
| View Dashboard | ✅ | |
| View Transaction Details | ✅ | |
| Add transaction (with optional proof) | ✅ | |
| Edit transaction | | ✅ |
| Delete transaction | | ✅ |
| View / download proof | ✅ | |

## Architecture & Cost

| Layer | Service | Free Tier (Spark) | Your Usage Est. |
|---|---|---|---|
| Auth (email + phone OTP) | Firebase Authentication | 10 phone OTPs/day on Spark | <5/day |
| Structured data + proofs | Cloud Firestore | 50K reads, 20K writes/day, 1 GiB storage | <1% of free tier |
| Hosting | Firebase Hosting | 10 GB stored, 360 MB/day transfer | Free |

**Total expected monthly cost: ₹0** — fully on Spark free plan, no card needed.

### How proofs are stored

Instead of using Firebase Storage (which requires the paid Blaze plan), proof files are:
1. **Images** — auto-compressed in the browser (max 1600px wide, JPEG quality reduced until <800KB)
2. **PDFs** — capped at 700KB (must be compressed beforehand by user if larger)
3. Converted to base64 string and saved inside the Firestore transaction document

Firestore allows documents up to 1 MB, so proofs comfortably fit alongside transaction metadata.

---

## Setup (one-time, ~10 minutes)

### 1. Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it (e.g., `ledger-app`) → finish setup (analytics optional)

### 2. Enable Authentication

1. In sidebar: **Build** → **Authentication** (or use search bar at top)
2. Click **Get started**
3. Under **Sign-in method** tab:
   - Click **Email/Password** → toggle **Enable** → Save
   - Click **Phone** → toggle **Enable** → Save

### 3. Create Firestore Database

1. In sidebar: **Build** → **Firestore Database** (or use search bar)
2. Click **Create database**
3. Pick location: **`asia-south1` (Mumbai)** ← cannot be changed later
4. Choose **Start in production mode** → Create
5. Wait ~30 seconds for provisioning

✅ **You do NOT need to enable Storage.** The app handles proofs without it.

### 4. Get Firebase Web Config

1. Project Overview (top of sidebar) → click ⚙️ **Project settings**
2. Scroll to **Your apps** → click the `</>` web icon
3. Register the app (a nickname is fine; skip hosting checkbox)
4. Copy the `firebaseConfig` object that appears

### 5. Add config to project

Open `src/lib/firebase.js` and replace the placeholder `firebaseConfig` with your real config.

### 6. Install & run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 7. Deploy to Firebase Hosting (free)

```bash
# Install Firebase CLI once
npm install -g firebase-tools

# Login
firebase login

# Link this folder to your Firebase project (run once)
firebase use --add
# pick your project, give it an alias like 'default'

# Deploy security rules first (important!)
firebase deploy --only firestore:rules

# Deploy the app
npm run build
firebase deploy --only hosting
```

You'll get a URL like `https://your-project.web.app` that anyone can access.

---

## Data Model

### Firestore: `transactions/{auto-id}`

```js
{
  paidByUid: "abc123",
  paidByName: "Chandan",
  paidByEmail: "chandan10106@gmail.com",
  date: "2026-04-30",            // ISO date
  year: 2026,
  month: 4,
  amount: 1500,                   // integer INR
  paidTo: "Electricity bill — March",
  mode: "UPI",                    // Cash | UPI | Card | NetBanking
  proofData: "data:image/jpeg;base64,/9j/4AA...",   // null if no proof
  proofType: "image/jpeg",
  proofName: "bill.jpg",
  createdAt: "2026-04-30T..."
}
```

### Firestore: `users/{uid}`

```js
{
  name: "Chandan",
  email: "chandan10106@gmail.com",
  phone: "+919876543210",        // if signed up via phone
  createdAt: "..."
}
```

---

## Project Structure

```
expense-tracker/
├── src/
│   ├── lib/
│   │   ├── firebase.js          # ⚠️ Edit this with YOUR firebase config
│   │   ├── AuthContext.jsx
│   │   └── fileUtils.js         # image compression + base64 helpers
│   ├── pages/
│   │   ├── AuthPage.jsx         # Login + Signup
│   │   ├── AppHome.jsx          # Tabs shell
│   │   ├── UpdateDetails.jsx    # Add transaction (everyone)
│   │   ├── Dashboard.jsx        # Charts & totals
│   │   └── TransactionDetails.jsx
│   ├── styles.css
│   └── main.jsx
├── firestore.rules              # Anyone can create, only admins can edit/delete
├── firebase.json
├── vite.config.js
└── package.json
```

---

## Adding More Admins

Edit **two places** with the new admin email (lowercase):

1. `src/lib/firebase.js` → `ADMIN_EMAILS` array
2. `firestore.rules` → the `isAdmin()` function

Then redeploy:
```bash
firebase deploy --only firestore:rules
npm run build && firebase deploy --only hosting
```

---

## Troubleshooting

### Phone OTP issues
- Spark plan gives **10 SMS verifications/day free**. Beyond that, you'd need Blaze. For your <50 user scale this is plenty.
- For testing, add a [test phone number](https://firebase.google.com/docs/auth/web/phone-auth#create-fictional-phone-numbers-and-verification-codes) under Authentication → Settings → Phone numbers for testing — these don't actually send SMS.

### "permission-denied" errors
- Make sure your logged-in email exactly matches an admin email (case insensitive)
- Make sure you've deployed the rules: `firebase deploy --only firestore:rules`

### "PDF is too large" error when adding a proof
- PDFs are capped at 700KB because Firestore documents can't exceed 1MB total
- Ask the uploader to compress the PDF first (Smallpdf, ILovePDF, etc.) or attach a screenshot/photo instead
- Images are auto-compressed and almost never hit this limit

### Document is over 1MB error
- Should not happen with images (auto-compressed) but possible with edge cases
- If you see this, just retry with a smaller proof file

---

Built carefully for clarity. Enjoy your ledger.
