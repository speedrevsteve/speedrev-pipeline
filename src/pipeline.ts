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
  "Company Name": string;
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
  const prompt = `You are Steve, founder of Speedrev — a GTM engineering firm that builds AI-powered outbound systems for recruiting agencies.

Write a cold email to ${lead["First Name"]} at ${lead["Company Name"]}.

HARD RULES — violating any of these means the message is rejected:
- Never start with "Noticed", "I noticed", "I saw", "I came across"
- Never use "--" dashes
- Never use made-up stats or percentages
- Never say "15-minute call", "leverage", "utilize", "scale", "human capital", "talent acquisition", "outbound prospecting"
- Never describe someone's job back to them in robotic HR language
- Never invent details not explicitly in the metadata
- If tech stack is just generic tools like Slack or Google, do not mention tech at all
- 3 sentences max, no exceptions
- No formal sign-off, no subject line

TONE — sound like this:
BAD: "Noticed you're scaling human capital businesses in Boston — curious how you're handling outbound prospecting."
GOOD: "Running a recruiting firm in Boston right now seems brutal with how competitive the market's gotten."

BAD: "We've helped similar firms 3x their candidate pipeline."
GOOD: "We build the outbound system so your team can focus on the actual placements."

BAD: "Would you be open to a quick 15-minute call?"
GOOD: "Worth a chat?"  or  "Open to a quick call sometime?"

The goal is one reply. Not a demo. Not a close. Just a reply.

Metadata (only use what is concrete and specific):
Name: ${lead["First Name"]} ${lead["Last Name"]}
Title: ${lead["Title"]}
Company: ${lead["Company Name"]}
Industry: ${lead["Industry"]}
Headcount: ${lead["# Employees"]} Tech stack: ${lead["Technologies"]}
Keywords: ${lead["Keywords"]}
Location: ${lead["City"]}, ${lead["State"]}

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
          company_name: row["Company Name"],
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
    // 3. Upsert outreach record
const { error: outreachError } = await supabase
  .from("outreach")
  .upsert(
    {
      lead_id: lead.id,
      message1,
      status: "new",
    },
    { onConflict: "lead_id" }
  );

    if (outreachError) {
      console.error(`\n❌ Failed to insert outreach for ${email}: ${outreachError.message}`);
      failed++;
      continue;
    }

    console.log(` ✓ ${name} @ ${row["Company Name"]}`);
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
