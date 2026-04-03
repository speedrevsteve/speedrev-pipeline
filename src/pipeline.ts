import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { google } from "googleapis";

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
async function generateMessage1(lead: ApolloRow): Promise<string> {
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
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as { type: "text"; text: string }).text.trim();
}

async function generateMessage2(lead: ApolloRow): Promise<string> {
  const prompt = `You are Steve, founder of Speedrev — a GTM engineering firm that builds AI-powered outbound systems for recruiting agencies.

Write a short follow-up email (Message 2) to ${lead["First Name"]} at ${lead["Company Name"]}. This is a bump sent 3 days after the first email with no reply.

HARD RULES:
- 2 sentences max
- Don't reference the first email directly ("just following up", "circling back", "checking in")
- Don't be needy or apologetic
- Add a new angle or observation — don't repeat Message 1
- No formal sign-off, no subject line
- Peer-to-peer tone

The goal is one reply. Keep it short and confident.

Metadata:
Name: ${lead["First Name"]} ${lead["Last Name"]}
Title: ${lead["Title"]}
Company: ${lead["Company Name"]}
Industry: ${lead["Industry"]}

Write the message now:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as { type: "text"; text: string }).text.trim();
}

async function generateMessage3(lead: ApolloRow): Promise<string> {
  const prompt = `You are Steve, founder of Speedrev — a GTM engineering firm that builds AI-powered outbound systems for recruiting agencies.

Write a breakup email (Message 3) to ${lead["First Name"]} at ${lead["Company Name"]}. This is the final email in a sequence, sent 5 days after Message 2 with no reply.

HARD RULES:
- 2 sentences max
- Closing the loop — make it clear this is the last message
- No guilt, no pressure, no "I'll leave you alone"
- Leave the door open naturally
- No formal sign-off, no subject line

The goal is to get a reply from someone who was interested but busy.

Metadata:
Name: ${lead["First Name"]} ${lead["Last Name"]}
Title: ${lead["Title"]}
Company: ${lead["Company Name"]}
Industry: ${lead["Industry"]}

Write the message now:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as { type: "text"; text: string }).text.trim();
}

// ── Google Sheets ─────────────────────────────────────────────────────────────
async function createSheetForCsv(csvName: string, rows: any[]) {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: process.env.GOOGLE_SHARE_EMAIL },
  });

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // Copy template sheet (has Apps Script already attached)
  const TEMPLATE_ID = "1cO0nVi1T93WuZIIhiDarxYxl06xjccg1kUUH2KkV6K0";
  const FOLDER_ID = "1Nxgc_a5hyEL26ZlRSdxQUDYBJzmQUQ0_";

  const file = await drive.files.copy({
    fileId: TEMPLATE_ID,
    requestBody: {
      name: `Speedrev — ${csvName}`,
      parents: [FOLDER_ID],
    },
    fields: "id",
  });

  const spreadsheetId = file.data.id!;

  // Clear existing data from template (keep headers row)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Leads!A2:Z",
  });

  const HEADERS = ["First Name", "Last Name", "Email", "Title", "Company", "Industry", "Headcount", "LinkedIn", "Tech Stack", "Keywords", "Message", "Message Type", "Send After", "Status", "Generated At", "Outreach ID"];

  const sheetRows = [[...HEADERS]];
  for (const row of rows) {
    const lead = row.leads || {};
    sheetRows.push([
      lead.first_name || "", lead.last_name || "", lead.email || "",
      lead.title || "", lead.company_name || "", lead.industry || "",
      lead.headcount || "", lead.linkedin_url || "", lead.tech_stack || "", lead.keywords || "",
      row.message1 || "", row.message_type || "", row.send_after || "",
      row.status || "", row.generated_at || "", row.id || "",
    ]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Leads!A1",
    valueInputOption: "RAW",
    requestBody: { values: sheetRows },
  });

  // Format header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.1, green: 0.1, blue: 0.18 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      }],
    },
  });

  // Share with your business email
  if (process.env.GOOGLE_SHARE_EMAIL) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { type: "user", role: "writer", emailAddress: process.env.GOOGLE_SHARE_EMAIL },
    });
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  console.log(`\n📊 Google Sheet created: ${url}`);
  return url;
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

  const now = new Date();
  const sendAfterMsg2 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // +3 days
  const sendAfterMsg3 = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000); // +8 days (3+5)

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

    // 2. Check if outreach already exists for this lead
    const { data: existing } = await supabase
      .from("outreach")
      .select("id")
      .eq("lead_id", lead.id)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`⏭  Skipping ${name} — outreach already exists`);
      skipped++;
      continue;
    }

    // 3. Generate all 3 messages
    process.stdout.write(`⏳ Generating messages for ${name}...`);
    let message1: string, message2: string, message3: string;
    try {
      message1 = await generateMessage1(row);
      message2 = await generateMessage2(row);
      message3 = await generateMessage3(row);
    } catch (err: any) {
      console.error(`\n❌ Claude error for ${email}: ${err.message}`);
      failed++;
      continue;
    }

    // 4. Insert 3 outreach rows
    const { error: outreachError } = await supabase.from("outreach").insert([
      {
        lead_id: lead.id,
        message1,
        status: "new",
        message_type: "message1",
        send_after: now.toISOString(),
      },
      {
        lead_id: lead.id,
        message1: message2,
        status: "new",
        message_type: "message2",
        send_after: sendAfterMsg2.toISOString(),
      },
      {
        lead_id: lead.id,
        message1: message3,
        status: "new",
        message_type: "message3",
        send_after: sendAfterMsg3.toISOString(),
      },
    ]);

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

  console.log(`📊 Creating Google Sheet...`);
  const csvName = path.basename(csvPath, ".csv");
  const csvEmails = rows.map(r => r["Email"]?.trim()).filter(Boolean);

  const { data: outreachRows } = await supabase
    .from("outreach")
    .select("id,message1,status,message_type,send_after,generated_at,leads!inner(first_name,last_name,email,title,company_name,industry,headcount,linkedin_url,tech_stack,keywords)")
    .in("leads.email", csvEmails)
    .order("generated_at", { ascending: false });

  if (outreachRows && outreachRows.length > 0) {
    await createSheetForCsv(csvName, outreachRows);
  } else {
    console.log("No outreach data found for these leads.");
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npm run pipeline -- <path-to-apollo-export.csv>");
  console.error("Example: npm run pipeline -- samples/apollo_export.csv");
  process.exit(1);
}

run(csvPath);
