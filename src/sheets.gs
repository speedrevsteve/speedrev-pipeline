const SUPABASE_URL = "https://bpdggmelglewdouwxjfm.supabase.co";
const SUPABASE_SERVICE_KEY = "YOUR_SUPABASE_SERVICE_KEY";
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY";
const HUBSPOT_API_KEY = "YOUR_HUBSPOT_API_KEY";

var HEADERS = ["First Name", "Last Name", "Email", "Title", "Company", "Industry", "Headcount", "LinkedIn", "Tech Stack", "Keywords", "Message", "Message Type", "Send After", "Status", "Generated At", "Outreach ID"];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Speedrev")
    .addItem("Refresh Leads", "syncLeads")
    .addItem("Send Selected Lead", "sendSelectedLead")
    .addSeparator()
    .addItem("Refresh Dashboard", "syncDashboard")
    .addToUi();
}

function getLeadsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Leads");
  if (!sheet) { sheet = ss.insertSheet("Leads"); }
  return sheet;
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
  if (status !== 200) throw new Error("Anthropic API failed (" + status + "): " + body);
  return JSON.parse(body).content[0].text.trim();
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
    payload: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
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
    headers: { Authorization: "Bearer " + HUBSPOT_API_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }] }),
    muteHttpExceptions: true
  });
  var searchData = JSON.parse(searchResponse.getContentText());
  if (searchData.total > 0) return searchData.results[0].id;

  var createResponse = UrlFetchApp.fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "post",
    headers: { Authorization: "Bearer " + HUBSPOT_API_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({ properties: { email: email, firstname: firstName, lastname: lastName, jobtitle: title, company: company } }),
    muteHttpExceptions: true
  });
  return JSON.parse(createResponse.getContentText()).id;
}

function logEmailToHubSpot(contactId, subject, message) {
  var response = UrlFetchApp.fetch("https://api.hubapi.com/crm/v3/objects/emails", {
    method: "post",
    headers: { Authorization: "Bearer " + HUBSPOT_API_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({
      properties: { hs_timestamp: new Date().getTime(), hs_email_direction: "EMAIL", hs_email_status: "SENT", hs_email_subject: subject, hs_email_text: message },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }] }]
    }),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  if (status !== 201) throw new Error("HubSpot email log failed (" + status + "): " + response.getContentText());
}

function sendSelectedLead() {
  try {
    var sheet = getLeadsSheet();
    var row = sheet.getActiveCell().getRow();
    if (row <= 1) { SpreadsheetApp.getUi().alert("Please select a lead row first."); return; }

    var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    function get(col) { return values[HEADERS.indexOf(col)] || ""; }

    var email = get("Email");
    var firstName = get("First Name");
    var lastName = get("Last Name");
    var title = get("Title");
    var company = get("Company");
    var message = get("Message");
    var outreachId = get("Outreach ID");
    var messageType = get("Message Type");
    var sendAfter = get("Send After");

    if (!email) { SpreadsheetApp.getUi().alert("No email found for this lead."); return; }
    if (!message) { SpreadsheetApp.getUi().alert("No message found for this lead."); return; }

    // Time gate check
    if (sendAfter) {
      var sendAfterDate = new Date(sendAfter);
      var now = new Date();
      if (now < sendAfterDate) {
        SpreadsheetApp.getUi().alert(messageType + " cannot be sent until " + sendAfterDate.toLocaleDateString() + ". Please wait.");
        return;
      }
    }

    // Check Supabase directly — source of truth for sent status
    var checkResponse = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?id=eq." + outreachId + "&select=status,lead_id,message_type", {
      method: "get",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      muteHttpExceptions: true
    });

    var checkData = JSON.parse(checkResponse.getContentText());
    if (checkData.length > 0 && checkData[0].status === "sent") {
      var statusCol = HEADERS.indexOf("Status") + 1;
      sheet.getRange(row, statusCol).setValue("sent");
      sheet.getRange(row, statusCol).setBackground("#c6efce");
      SpreadsheetApp.getUi().alert("Already sent to " + email + " — row updated.");
      return;
    }

    // For message2/message3 — verify previous message was sent
    if (messageType === "message2" || messageType === "message3") {
      var leadId = checkData.length > 0 ? checkData[0].lead_id : null;
      var prevType = messageType === "message2" ? "message1" : "message2";

      if (leadId) {
        var prevResponse = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?lead_id=eq." + leadId + "&message_type=eq." + prevType + "&select=status", {
          method: "get",
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
          muteHttpExceptions: true
        });
        var prevData = JSON.parse(prevResponse.getContentText());
        if (!prevData.length || prevData[0].status !== "sent") {
          SpreadsheetApp.getUi().alert("Cannot send " + messageType + " — " + prevType + " has not been sent yet.");
          return;
        }
      }
    }

    var subject = generateSubjectLine(message);
    var ui = SpreadsheetApp.getUi();
    var confirm = ui.alert("Confirm Send", "To: " + email + "\nType: " + messageType + "\nSubject: " + subject + "\n\n" + message, ui.ButtonSet.OK_CANCEL);
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

    var statusCol = HEADERS.indexOf("Status") + 1;
    sheet.getRange(row, statusCol).setValue("sent");
    sheet.getRange(row, statusCol).setBackground("#c6efce");
    ui.alert("Sent " + messageType + " to " + firstName + " (" + email + ") and logged to HubSpot");

  } catch (err) {
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}

function syncLeads() {
  try {
    var sheet = getLeadsSheet();

    var response = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?select=id,message1,status,message_type,send_after,generated_at,leads(first_name,last_name,email,title,company_name,industry,headcount,linkedin_url,tech_stack,keywords)&order=generated_at.desc", {
      method: "get",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var body = response.getContentText();
    if (status !== 200) throw new Error("Supabase error (" + status + "): " + body);

    var rows = JSON.parse(body);
    if (!rows.length) { SpreadsheetApp.getUi().alert("No leads found."); return; }

    // Always write locked headers on row 1
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#1a1a2e").setFontColor("#ffffff").setFontWeight("bold");

    // Build index of existing Outreach IDs
    var lastRow = sheet.getLastRow();
    var existingIds = {};
    var outreachIdCol = HEADERS.indexOf("Outreach ID") + 1;
    if (lastRow > 1) {
      var existingIdValues = sheet.getRange(2, outreachIdCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < existingIdValues.length; i++) {
        if (existingIdValues[i][0]) {
          existingIds[existingIdValues[i][0]] = i + 2;
        }
      }
    }

    var statusCol = HEADERS.indexOf("Status") + 1;
    var newRows = [];
    var newRowStatuses = [];
    var updated = 0;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowData = [
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
        row.message_type || "message1",
        row.send_after || "",
        row.status || "",
        row.generated_at || "",
        row.id || ""
      ];

      if (existingIds[row.id]) {
        var sheetRow = existingIds[row.id];
        var currentStatus = sheet.getRange(sheetRow, statusCol).getValue();
        if (currentStatus !== row.status) {
          sheet.getRange(sheetRow, statusCol).setValue(row.status);
          updated++;
        }
        if (row.status === "sent") {
          sheet.getRange(sheetRow, statusCol).setBackground("#c6efce");
        }
      } else {
        newRows.push(rowData);
        newRowStatuses.push(row.status);
      }
    }

    if (newRows.length > 0) {
      var appendRow = sheet.getLastRow() + 1;
      sheet.getRange(appendRow, 1, newRows.length, HEADERS.length).setValues(newRows);
      var msgCol = HEADERS.indexOf("Message") + 1;
      sheet.getRange(appendRow, msgCol, newRows.length, 1).setWrap(true);
      sheet.setColumnWidth(msgCol, 400);
      for (var j = 0; j < newRowStatuses.length; j++) {
        if (newRowStatuses[j] === "sent") {
          sheet.getRange(appendRow + j, statusCol).setBackground("#c6efce");
        }
      }
    }

    sheet.autoResizeColumns(1, HEADERS.length);
    SpreadsheetApp.getUi().alert("Synced: " + newRows.length + " new rows added, " + updated + " updated.");

  } catch (err) {
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}

function syncDashboard() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dash = ss.getSheetByName("Dashboard");
    if (!dash) { dash = ss.insertSheet("Dashboard"); }
    dash.clearContents();
    dash.clearFormats();

    var response = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/outreach?select=status,message_type,generated_at,sent_at", {
      method: "get",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error("Supabase error: " + response.getContentText());
    var rows = JSON.parse(response.getContentText());

    var leadsResponse = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/leads?select=id", {
      method: "get",
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      muteHttpExceptions: true
    });
    var totalLeads = JSON.parse(leadsResponse.getContentText()).length;

    var totalSent = 0, totalPending = 0, sentToday = 0, sentThisWeek = 0;
    var msg1Sent = 0, msg2Sent = 0, msg3Sent = 0;
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.status === "sent") {
        totalSent++;
        if (row.message_type === "message1") msg1Sent++;
        if (row.message_type === "message2") msg2Sent++;
        if (row.message_type === "message3") msg3Sent++;
        if (row.sent_at) {
          var sentAt = new Date(row.sent_at);
          if (sentAt >= startOfToday) sentToday++;
          if (sentAt >= startOfWeek) sentThisWeek++;
        }
      } else {
        totalPending++;
      }
    }

    var sentPct = rows.length > 0 ? Math.round((totalSent / rows.length) * 100) : 0;
    var bg = "#1a1a2e", white = "#ffffff", green = "#c6efce", yellow = "#ffeb9c";

    dash.getRange("A1:D1").merge().setValue("Speedrev Outreach Dashboard")
      .setBackground(bg).setFontColor(white).setFontSize(16).setFontWeight("bold");
    dash.getRange("A2:D2").merge().setValue("Last updated: " + now.toLocaleString())
      .setFontColor("#888888").setFontSize(10);
    dash.getRange(4, 1, 1, 2).setValues([["Metric", "Value"]])
      .setBackground(bg).setFontColor(white).setFontWeight("bold");

    var stats = [
      ["Total Leads", totalLeads],
      ["Total Emails Sent", totalSent],
      ["Message 1 Sent", msg1Sent],
      ["Message 2 Sent", msg2Sent],
      ["Message 3 Sent", msg3Sent],
      ["Pending", totalPending],
      ["Send Rate", sentPct + "%"],
      ["Sent Today", sentToday],
      ["Sent This Week", sentThisWeek]
    ];

    dash.getRange(5, 1, stats.length, 2).setValues(stats);
    dash.getRange(6, 1, 1, 2).setBackground(green);
    dash.getRange(11, 1, 1, 2).setBackground(yellow);
    dash.setColumnWidth(1, 200);
    dash.setColumnWidth(2, 120);
    dash.getRange(5, 1, stats.length, 2).setBorder(true, true, true, true, true, true);
    ss.setActiveSheet(dash);
    SpreadsheetApp.getUi().alert("Dashboard updated.");

  } catch (err) {
    SpreadsheetApp.getUi().alert("Dashboard error: " + err.message);
  }
}
