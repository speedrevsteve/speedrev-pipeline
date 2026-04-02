# Speedrev Lead Pipeline

Apollo CSV → Claude personalization → Supabase → Google Sheets

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add your credentials
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role key |

### 3. Set up Supabase tables
Run this SQL in your Supabase SQL editor:

```sql
create extension if not exists "pgcrypto";

create table leads (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text unique,
  title text,
  company_name text,
  industry text,
  headcount text,
  revenue text,
  linkedin_url text,
  twitter_url text,
  tech_stack text,
  keywords text,
  city text,
  state text,
  country text,
  created_at timestamp with time zone default now()
);

create table outreach (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  message1 text,
  status text default 'new' check (status in ('new', 'approved', 'sent')),
  generated_at timestamp with time zone default now(),
  sent_at timestamp with time zone
);
```

---

## Run the pipeline

Drop your Apollo CSV export into the `samples/` folder, then:

```bash
npm run pipeline -- samples/your_apollo_export.csv
```

To test with the included sample data:
```bash
npm run pipeline -- samples/apollo_export.csv
```

---

## Apollo CSV export tips

In Apollo, when exporting contacts make sure these columns are included:
- First Name, Last Name, Email, Title, Company
- Industry, # Employees, Annual Revenue
- Person Linkedin Url, Twitter
- Technologies, Keywords
- City, State, Country

---

## What it does

1. Reads each row from your Apollo CSV
2. Upserts the lead into the `leads` table (email is the unique key — safe to re-run)
3. Calls Claude to generate a personalized `Message1` based on the lead's metadata
4. Inserts the message into the `outreach` table with status `new`

---

## Google Sheets sync setup

This lets reps review and approve AI-generated messages in a spreadsheet before sending.

### Step 1 — Create the Google Sheet

1. Go to https://sheets.google.com and create a new sheet
2. Name it something like **Speedrev Outreach**
3. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/**SHEET_ID_HERE**/edit`

### Step 2 — Create a Google Cloud service account

1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one)
3. Enable the **Google Sheets API**: APIs & Services → Enable APIs → search "Google Sheets API" → Enable
4. Go to **APIs & Services → Credentials → Create Credentials → Service Account**
5. Name it (e.g. `speedrev-sheets`) and click Create
6. On the service account page, go to **Keys → Add Key → Create new key → JSON**
7. Download the JSON file — **do not commit this file**

### Step 3 — Share the sheet with the service account

1. Open the JSON key file and copy the `client_email` value (looks like `name@project.iam.gserviceaccount.com`)
2. In your Google Sheet, click **Share** and paste that email with **Editor** access

### Step 4 — Add credentials to .env

From the JSON key file, add these to your `.env`:

```
GOOGLE_SHEET_ID=your-sheet-id-from-url
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> The private key must be wrapped in double quotes and have literal `\n` for newlines (copy exactly from the JSON file's `private_key` field).

### Step 5 — Install googleapis

```bash
npm install googleapis
```

### Step 6 — Run the sync

```bash
npm run sync-sheets
```

This reads all `outreach` rows (joined with `leads`) from Supabase and writes them to the sheet with columns:

| Name | Email | Company | Title | Message1 | Status | Generated At |

Reps update the **Status** column to `approved` directly in the sheet.

### Step 7 — Push approvals back to Supabase

```bash
npm run push-approvals
```

This reads rows where Status = `approved` from the sheet and updates the matching `outreach` record in Supabase.

---

## Status flow

```
new → approved (rep marks in sheet) → sent (after sending via Apollo/outreach tool)
```

---

## Apollo sequence tips

Once messages are approved in Supabase:
1. Export approved leads from Supabase (or query directly)
2. In Apollo, go to **Sequences → New Sequence**
3. Add a manual email step — paste the approved `message1` as the template
4. Upload your lead list and launch

For fully automated sending, Apollo's API supports adding contacts to a sequence programmatically — see `apollo_emailer_campaigns_add_contact_ids` in the Apollo API docs.
