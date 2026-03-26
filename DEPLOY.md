# Chatflight — Deployment Guide

## What you have
A complete flight search app with:
- AI chat powered by Claude (Anthropic)
- Real flight data from Duffel
- Hybrid chat + form interface
- Ranked results with AI recommendations

## Files in this package
```
chatflight/
├── public/
│   ├── index.html      ← The website frontend
│   └── app.js          ← Frontend logic
├── api/
│   ├── chat.js         ← AI chat backend (uses Anthropic)
│   └── search.js       ← Flight search backend (uses Duffel)
├── vercel.json         ← Vercel configuration
├── package.json        ← Project config
├── .env.example        ← API keys template
├── .gitignore          ← Files to exclude from GitHub
└── DEPLOY.md           ← This file
```

---

## Step 1 — Put the code on GitHub

1. Go to github.com and log in
2. Click the **+** icon (top right) → **New repository**
3. Name it `chatflight`
4. Leave it **Public** (required for free Vercel deployment)
5. Click **Create repository**
6. On the next page, click **uploading an existing file**
7. Drag ALL the files and folders from this package into the upload area
   - Make sure to keep the folder structure (public/ and api/ as folders)
8. Scroll down, click **Commit changes**

---

## Step 2 — Deploy to Vercel

1. Go to vercel.com and click **Sign Up**
2. Choose **Continue with GitHub** — connect your GitHub account
3. Click **Add New Project**
4. Find and select your `chatflight` repository
5. Click **Deploy** — leave all settings as default
6. Wait about 60 seconds for the first deploy

Your app will be live at: `https://chatflight-xxx.vercel.app`
(Vercel gives you a random URL at first)

---

## Step 3 — Add your API keys (IMPORTANT)

Without this step the app will load but searches won't work.

1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add these two variables one at a time:

   **Variable 1:**
   - Name: `DUFFEL_API_KEY`
   - Value: your Duffel key (starts with `duffel_test_`)
   - Environment: Production, Preview, Development (tick all three)
   - Click Save

   **Variable 2:**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your Anthropic key (starts with `sk-ant-`)
   - Environment: Production, Preview, Development (tick all three)
   - Click Save

3. Go to **Deployments** → click the three dots on the latest deployment → **Redeploy**
4. Wait 60 seconds

---

## Step 4 — Test it

1. Visit your Vercel URL
2. Try the chat: type "cheapest flights from Sydney to London in June"
3. Try the form: fill in SYD → LHR, pick a date, click Search
4. You should see real flight results from Duffel

---

## Step 5 — Add a custom domain (optional, later)

1. Buy a domain at namecheap.com (~A$15/year)
2. In Vercel → Settings → Domains → Add your domain
3. Follow the DNS instructions Vercel gives you
4. Done — your app is now at your own domain

---

## Troubleshooting

**"No flights found"** — Duffel test mode has limited airlines. Try major routes like SYD→LHR or SYD→SIN.

**Chat not responding** — Check your ANTHROPIC_API_KEY is set correctly in Vercel environment variables.

**App not loading** — Check Vercel deployment logs for errors (Vercel dashboard → Deployments → click the deployment → View logs).

**API key errors** — Make sure you redeployed after adding environment variables.

---

## What's next (Version 2)

- Price history database (Supabase)
- Calendar heatmap with live prices
- Price trend charts
- Price alerts via email
- Mobile app

Congratulations — you've launched! 🚀
