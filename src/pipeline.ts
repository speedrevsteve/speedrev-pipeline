import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";

dotenv.config();


// ── Config ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ────────────────────────────────────────────────────────────────────
interface ApolloRow {
  "First Name": string;
  "Last Name": string;
  Email: string;
  Title: string;
  Company: string;
  Industry: string;
  "# Employees": string;
  "Annual Revenue": string;
  "Person Linkedin Url": string;
  Twitter: string;
  Technologies: string;
  Keywords: string;
  City: string;
  State: string;
  Country: string;
}

// ── Message generation ────────────────────────────────────────────────────────
async function generateMessage(lead: ApolloRow): Promise<string> {
  const prompt = `You are an expert B2B sales copywriter for Speedrev, a GTM engineering consultancy that builds AI-powered outbound sales automation for recruiting agencies.

Write a short, highly personalized cold outreach message (Message1) for the following prospect.

Rules:
- 3-4 sentences max
- Reference something specific from their metadata (title, company, industry, tech stack, or keywords)
- Do NOT use generic openers like "I hope this finds you well"
- End with a soft CTA — ask for a 15 min call or if they're open to a quick chat
- Tone: confident, peer-to-peer, no fluff
- Do NOT include a subject line, just the message body

Prospect metadata:
Name: ${lead["First Name"]} ${lead["Last Name"]}
Title: ${lead["Title"]}
Company: ${lead["Company"]}
Industry: ${lead["Industry"]}
Headcount: ${lead["# Employees"]}
Revenue: ${lead["Annual Revenue"]}
Tech stack: ${lead["Technologies"]}
Keywords: ${lead["Keywords"]}
Location: ${lead["City"]}, ${lead["State"]}, ${lead["Country"]}

Write the message now:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as { type: "text"; text: string }).text.trim();
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function run(csvPath: string) {
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File not found: ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows: ApolloRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`\n🚀 Speedrev Pipeline starting — ${rows.length} leads found\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const email = row["Email"]?.trim();
    const name = `${row["First Name"]} ${row["Last Name"]}`;

    if (!email) {
      console.warn(`⚠️  Skipping ${name} — no email`);
      skipped++;
      continue;
    }

    // 1. Upsert lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .upsert(
        {
          first_name: row["First Name"],
          last_name: row["Last Name"],
          email,
          title: row["Title"],
          company_name: row["Company"],
          industry: row["Industry"],
          headcount: row["# Employees"],
          revenue: row["Annual Revenue"],
          linkedin_url: row["Person Linkedin Url"],
          twitter_url: row["Twitter"],
          tech_stack: row["Technologies"],
          keywords: row["Keywords"],
          city: row["City"],
          state: row["State"],
          country: row["Country"],
        },
        { onConflict: "email" }
      )
      .select("id")
      .single();

    if (leadError || !lead) {
  console.error(`❌ Failed to upsert ${email}:`, JSON.stringify(leadError));
      failed++;
      continue;
    }

    // 2. Generate message
    process.stdout.write(`⏳ Generating message for ${name}...`);
    let message1: string;
    try {
      message1 = await generateMessage(row);
    } catch (err: any) {
      console.error(`\n❌ Claude error for ${email}: ${err.message}`);
      failed++;
      continue;
    }

    // 3. Insert outreach record
    const { error: outreachError } = await supabase.from("outreach").insert({
      lead_id: lead.id,
      message1,
      status: "new",
    });

    if (outreachError) {
      console.error(`\n❌ Failed to insert outreach for ${email}: ${outreachError.message}`);
      failed++;
      continue;
    }

    console.log(` ✓ ${name} @ ${row["Company"]}`);
    success++;
  }

  console.log(`\n── Results ──────────────────────────────`);
  console.log(`✅ Success:  ${success}`);
  console.log(`⚠️  Skipped:  ${skipped}`);
  console.log(`❌ Failed:   ${failed}`);
  console.log(`─────────────────────────────────────────\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npm run pipeline -- <path-to-apollo-export.csv>");
  console.error("Example: npm run pipeline -- samples/apollo_export.csv");
  process.exit(1);
}

run(csvPath);
