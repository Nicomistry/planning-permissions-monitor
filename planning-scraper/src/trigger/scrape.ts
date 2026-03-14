import { task, logger } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { processCouncilTask, type MergedLead } from "./process-council";

// ─── Councils ─────────────────────────────────────────────────────────────────

const COUNCILS = [
  { name: "Windsor & Maidenhead", auth: "Windsor" },
  { name: "Hillingdon",           auth: "Hillingdon" },
  { name: "Dacorum",              auth: "Dacorum" },
  { name: "Wokingham",            auth: "Wokingham" },
  { name: "Surrey Heath",         auth: "SurreyHeath" },
  { name: "Runnymede",            auth: "Runnymede" },
];

// ─── Email builder ────────────────────────────────────────────────────────────

function priorityBadge(priority: string): string {
  const colours: Record<string, string> = {
    HIGH:   "background:#16a34a;color:#fff",
    MEDIUM: "background:#d97706;color:#fff",
    LOW:    "background:#6b7280;color:#fff",
  };
  const style = colours[priority] ?? colours.LOW;
  return `<span style="${style};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">${priority}</span>`;
}

function scoreBar(score: number): string {
  const filled = Math.round((score / 10) * 10);
  const colour = score >= 8 ? "#16a34a" : score >= 5 ? "#d97706" : "#6b7280";
  return `<span style="font-size:16px;font-weight:700;color:${colour}">${score}</span><span style="color:#9ca3af;font-size:11px">/10</span>`;
}

function leadRow(lead: MergedLead): string {
  const desc = lead.description.length > 120
    ? lead.description.slice(0, 120) + "…"
    : lead.description;
  const viewLink = lead.planit_url
    ? `<a href="${lead.planit_url}" style="color:#00d084;text-decoration:none;font-size:11px;">View →</a>`
    : "";

  return `
    <tr style="border-bottom:1px solid #1f2937;">
      <td style="padding:12px 8px;vertical-align:top;">
        <div style="font-weight:600;color:#f9fafb;font-size:13px;">${lead.address}</div>
        <div style="color:#9ca3af;font-size:11px;margin-top:2px;">${lead.postcode}</div>
        <div style="color:#6b7280;font-size:11px;margin-top:4px;">${desc}</div>
      </td>
      <td style="padding:12px 8px;vertical-align:top;white-space:nowrap;">
        <div style="color:#d1d5db;font-size:12px;">${lead.dwelling_type}</div>
        <div style="color:#9ca3af;font-size:11px;">${lead.development_scale}</div>
        ${lead.unit_count != null ? `<div style="color:#9ca3af;font-size:11px;">${lead.unit_count} unit${lead.unit_count !== 1 ? "s" : ""}</div>` : ""}
      </td>
      <td style="padding:12px 8px;vertical-align:top;text-align:center;">${scoreBar(lead.opportunity_score)}</td>
      <td style="padding:12px 8px;vertical-align:top;text-align:center;">${priorityBadge(lead.priority)}</td>
      <td style="padding:12px 8px;vertical-align:top;">
        <div style="color:#d1d5db;font-size:11px;">${lead.applicant_name ?? "—"}</div>
        <div style="color:#9ca3af;font-size:11px;">${lead.agent_name ?? ""}</div>
      </td>
      <td style="padding:12px 8px;vertical-align:top;text-align:center;">${viewLink}</td>
    </tr>
    <tr style="border-bottom:1px solid #111827;">
      <td colspan="6" style="padding:4px 8px 12px 8px;">
        <span style="color:#6b7280;font-size:11px;font-style:italic;">${lead.score_reasoning}</span>
      </td>
    </tr>`;
}

function buildEmailHtml(allLeads: MergedLead[], runDate: string): string {
  // Group by council, sort each group by score desc
  const byCouncil = new Map<string, MergedLead[]>();
  for (const lead of allLeads) {
    if (!byCouncil.has(lead.council)) byCouncil.set(lead.council, []);
    byCouncil.get(lead.council)!.push(lead);
  }
  for (const leads of byCouncil.values()) {
    leads.sort((a, b) => b.opportunity_score - a.opportunity_score);
  }

  const highCount  = allLeads.filter((l) => l.priority === "HIGH").length;
  const medCount   = allLeads.filter((l) => l.priority === "MEDIUM").length;

  const councilSections = Array.from(byCouncil.entries())
    .map(([council, leads]) => `
      <h3 style="color:#00d084;font-size:14px;font-weight:600;margin:28px 0 8px 0;letter-spacing:0.05em;text-transform:uppercase;">
        ${council} <span style="color:#6b7280;font-weight:400;">(${leads.length})</span>
      </h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #1f2937;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#111827;">
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Address</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Type</th>
            <th style="padding:8px;text-align:center;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Score</th>
            <th style="padding:8px;text-align:center;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Priority</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Applicant</th>
            <th style="padding:8px;text-align:center;color:#6b7280;font-size:11px;font-weight:500;text-transform:uppercase;">Link</th>
          </tr>
        </thead>
        <tbody>
          ${leads.map(leadRow).join("")}
        </tbody>
      </table>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:800px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="border-bottom:2px solid #00d084;padding-bottom:20px;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:700;color:#f9fafb;letter-spacing:-0.5px;">
        🏗️ Planning Leads Digest
      </div>
      <div style="color:#9ca3af;font-size:13px;margin-top:4px;">${runDate}</div>
    </div>

    <!-- Stats bar -->
    <div style="display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap;">
      <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 20px;flex:1;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#f9fafb;">${allLeads.length}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">Total Leads</div>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 20px;flex:1;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#16a34a;">${highCount}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">HIGH Priority</div>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 20px;flex:1;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#d97706;">${medCount}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">MEDIUM Priority</div>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 20px;flex:1;min-width:100px;">
        <div style="font-size:28px;font-weight:700;color:#9ca3af;">${byCouncil.size}</div>
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">Councils</div>
      </div>
    </div>

    <!-- Leads by council -->
    ${councilSections}

    <!-- Footer -->
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #1f2937;color:#4b5563;font-size:11px;text-align:center;">
      Planning Leads System — Automated Run via Trigger.dev
    </div>
  </div>
</body>
</html>`;
}

// ─── Orchestrator task ────────────────────────────────────────────────────────

export const scrapePlanningLeadsTask = task({
  id: "planning-scraper",
  maxDuration: 1800, // 30 minutes total

  run: async (payload: { userId?: string } = {}) => {
    const { userId } = payload;
    const runDate = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    logger.info(`Planning scraper started — ${runDate}`);
    logger.info(`Councils to process: ${COUNCILS.map((c) => c.name).join(", ")}`);

    const allLeads: MergedLead[] = [];

    // Process each council sequentially via triggerAndWait
    for (const council of COUNCILS) {
      logger.info(`Triggering: ${council.name}`);

      const result = await processCouncilTask.triggerAndWait({
        council_name: council.name,
        council_auth: council.auth,
        userId,
      });

      if (result.ok) {
        const { leads } = result.output;
        logger.info(`${council.name}: ${leads.length} leads`);
        allLeads.push(...leads);
      } else {
        logger.error(`${council.name}: task failed`, { error: result.error });
      }
    }

    logger.info(`All councils done. Total leads: ${allLeads.length}`);

    if (allLeads.length === 0) {
      logger.info("No leads found — skipping email");
      return { leads_found: 0, email_sent: false };
    }

    // Send digest email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = buildEmailHtml(allLeads, runDate);
    const subject = `🏗️ Planning Leads — ${runDate} (${allLeads.length} leads, ${allLeads.filter((l) => l.priority === "HIGH").length} HIGH)`;

    const emailResult = await resend.emails.send({
      // NOTE: replace with your verified Resend domain, or use onboarding@resend.dev for testing
      from: "Planning Leads <onboarding@resend.dev>",
      to: process.env.DIGEST_EMAIL ?? "nicomistry@gmail.com",
      subject,
      html,
    });

    if (emailResult.error) {
      logger.error("Email send failed", { error: emailResult.error });
      throw new Error(`Email failed: ${emailResult.error.message}`);
    }

    logger.info(`✉ Email sent`, { id: emailResult.data?.id });

    return {
      leads_found: allLeads.length,
      high_priority: allLeads.filter((l) => l.priority === "HIGH").length,
      email_sent: true,
      email_id: emailResult.data?.id,
    };
  },
});
