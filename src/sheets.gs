const SUPABASE_URL = "https://bpdggmelglewdouwxjfm.supabase.co";
const SUPABASE_SERVICE_KEY = "YOUR_SUPABASE_SERVICE_KEY";
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY";
const HUBSPOT_API_KEY = "YOUR_HUBSPOT_API_KEY";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Speedrev")
    .addItem("Refresh Leads", "syncLeads")
    .addItem("Send Selected Lead", "sendSelectedLead")
    .addToUi();
}

function generateSubjectLine(message) {
  var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    payload: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 50,
      messages: [{
        role: "user",
        content: "Write a short, punchy cold email subject line for this message. 5 words max. No quotes, no punctuation at the end, no clickbait.\n\nMessage:\n" + message
      }]
    }),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();
  if (status !== 200) {
    throw new Error("Anthropic API failed (" + status + "): " + body);
  }
  var data = JSON.parse(body);
  return data.content[0].text.trim();
}

function updateStatus(outreachId) {
  Logger.log("updateStatus called with outreachId: " + outreachId);

  if (!outreachId) {
    SpreadsheetApp.getUi().alert("Warning: no Outreach ID found — status not updated in Supabase.");
    return;
  }

  var response = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?id=eq." + outreachId, {
    method: "patch",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    payload: JSON.stringify({
      status: "sent",
      sent_at: new Date().toISOString()
    }),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  if (status !== 204) {
    SpreadsheetApp.getUi().alert("Supabase update failed (" + status + "): " + response.getContentText());
  }
}

function getOrCreateHubSpotContact(email, firstName, lastName, title, company) {
  var searchResponse = UrlFetchApp.fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "post",
    headers: {
      Authorization: "Bearer " + HUBSPOT_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: "email",
          operator: "EQ",
          value: email
        }]
      }]
    }),
    muteHttpExceptions: true
  });

  var searchData = JSON.parse(searchResponse.getContentText());
  if (searchData.total > 0) {
    return searchData.results[0].id;
  }

  var createResponse = UrlFetchApp.fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "post",
    headers: {
      Authorization: "Bearer " + HUBSPOT_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      properties: {
        email: email,
        firstname: firstName,
        lastname: lastName,
        jobtitle: title,
        company: company
      }
    }),
    muteHttpExceptions: true
  });

  var createData = JSON.parse(createResponse.getContentText());
  return createData.id;
}

function logEmailToHubSpot(contactId, subject, message) {
  var now = new Date().getTime();
  var payload = {
    properties: {
      hs_timestamp: now,
      hs_email_direction: "EMAIL",
      hs_email_status: "SENT",
      hs_email_subject: subject,
      hs_email_text: message
    },
    associations: [{
      to: { id: contactId },
      types: [{
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 198
      }]
    }]
  };

  var response = UrlFetchApp.fetch("https://api.hubapi.com/crm/v3/objects/emails", {
    method: "post",
    headers: {
      Authorization: "Bearer " + HUBSPOT_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();
  if (status !== 201) {
    throw new Error("HubSpot email log failed (" + status + "): " + body);
  }
}

function sendSelectedLead() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var row = sheet.getActiveCell().getRow();

    if (row <= 1) {
      SpreadsheetApp.getUi().alert("Please select a lead row first.");
      return;
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

    function get(col) {
      return values[headers.indexOf(col)] || "";
    }

    var email = get("Email");
    var firstName = get("First Name");
    var lastName = get("Last Name");
    var title = get("Title");
    var company = get("Company");
    var message = get("Message1");
    var outreachId = get("Outreach ID");
    var status = get("Status");

    if (!email) {
      SpreadsheetApp.getUi().alert("No email found for this lead.");
      return;
    }
    if (status === "sent") {
      SpreadsheetApp.getUi().alert("Already sent to " + email);
      return;
    }
    if (!message) {
      SpreadsheetApp.getUi().alert("No message found for this lead.");
      return;
    }

    var subject = generateSubjectLine(message);
    var ui = SpreadsheetApp.getUi();
    var confirm = ui.alert("Confirm Send", "To: " + email + "\nSubject: " + subject + "\n\n" + message, ui.ButtonSet.OK_CANCEL);
    if (confirm !== ui.Button.OK) return;

    GmailApp.sendEmail(email, subject, message);
    updateStatus(outreachId);

    try {
      var contactId = getOrCreateHubSpotContact(email, firstName, lastName, title, company);
      logEmailToHubSpot(contactId, subject, message);
    } catch (hubErr) {
      SpreadsheetApp.getUi().alert("Email sent but HubSpot logging failed: " + hubErr.message);
      return;
    }

    var statusCol = headers.indexOf("Status") + 1;
    sheet.getRange(row, statusCol).setValue("sent");
    sheet.getRange(row, statusCol).setBackground("#c6efce");
    ui.alert("Sent to " + firstName + " (" + email + ") and logged to HubSpot");

  } catch (err) {
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}

function syncLeads() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    var response = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?select=id,message1,status,generated_at,leads(first_name,last_name,email,title,company_name,industry,headcount,linkedin_url,tech_stack,keywords)&order=generated_at.desc", {
      method: "get",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var body = response.getContentText();
    if (status !== 200) {
      throw new Error("Supabase error (" + status + "): " + body);
    }

    var rows = JSON.parse(body);
    if (!rows.length) {
      SpreadsheetApp.getUi().alert("No leads found.");
      return;
    }

    var headers = ["First Name", "Last Name", "Email", "Title", "Company", "Industry", "Headcount", "LinkedIn", "Tech Stack", "Keywords", "Message1", "Status", "Generated At", "Outreach ID"];

    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#1a1a2e");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");

    var data = rows.map(function(row) {
      return [
        row.leads ? row.leads.first_name || "" : "",
        row.leads ? row.leads.last_name || "" : "",
        row.leads ? row.leads.email || "" : "",
        row.leads ? row.leads.title || "" : "",
        row.leads ? row.leads.company_name || "" : "",
        row.leads ? row.leads.industry || "" : "",
        row.leads ? row.leads.headcount || "" : "",
        row.leads ? row.leads.linkedin_url || "" : "",
        row.leads ? row.leads.tech_stack || "" : "",
        row.leads ? row.leads.keywords || "" : "",
        row.message1 || "",
        row.status || "",
        row.generated_at || "",
        row.id || ""
      ];
    });

    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    sheet.autoResizeColumns(1, headers.length);
    sheet.getRange(2, 11, data.length, 1).setWrap(true);
    sheet.setColumnWidth(11, 400);

    SpreadsheetApp.getUi().alert("Synced " + rows.length + " leads.");

  } catch (err) {
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}
