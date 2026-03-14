import { task, logger } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { processCouncilTask, type MergedLead } from "./process-council";

// ─── Councils ─────────────────────────────────────────────────────────────────

// Default councils (admin / no-selection fallback)
const DEFAULT_COUNCILS = [
  { name: "Windsor & Maidenhead", auth: "Windsor" },
  { name: "Hillingdon",           auth: "Hillingdon" },
  { name: "Dacorum",              auth: "Dacorum" },
  { name: "Wokingham",            auth: "Wokingham" },
  { name: "Surrey Heath",         auth: "SurreyHeath" },
  { name: "Runnymede",            auth: "Runnymede" },
];

// Known name → PlanIT auth exceptions (where auth differs from the name)
const AUTH_EXCEPTIONS: Record<string, string> = {
  "Windsor & Maidenhead": "Windsor",
  "Surrey Heath":         "SurreyHeath",
  "Babergh Mid Suffolk":  "BaberghMidSuffolk",
  "Bromsgrove Redditch":  "BromsgrovRedditch",
  "South Norfolk Broadland": "SouthNorfolkBroadland",
};

function councilToAuth(name: string): string {
  if (AUTH_EXCEPTIONS[name]) return AUTH_EXCEPTIONS[name];
  // Default: remove spaces and special characters
  return name.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
}

function buildCouncilList(names: string[]): { name: string; auth: string }[] {
  return names.map((name) => ({ name, auth: councilToAuth(name) }));
}

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

  run: async (payload: {
    userId?: string;
    councils?: string[] | null;
    fanOut?: boolean;  // triggers all-user scan: scrape once, deliver to every user
  } = {}) => {
    const { userId, councils, fanOut } = payload;
    const runDate = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // ── Fan-out mode ───────────────────────────────────────────────────────────
    // Triggered by admin (no userId). Queries all users' council preferences,
    // scrapes each unique council once, then delivers leads to every user who
    // wants that council.
    if (fanOut) {
      logger.info("Fan-out mode: querying all users' council preferences");

      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      // 1. Fetch all profiles with non-empty scan_settings
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("user_id, scan_settings")
        .not("scan_settings", "is", null);

      if (profilesErr) {
        logger.error("Fan-out: failed to load profiles", { error: profilesErr.message });
        return { leads_found: 0, email_sent: false };
      }

      // 2. Build council → [userId, ...] map
      const councilMap = new Map<string, string[]>();
      for (const p of profiles ?? []) {
        const userCouncils: string[] = p.scan_settings?.councils ?? [];
        for (const name of userCouncils) {
          if (!councilMap.has(name)) councilMap.set(name, []);
          councilMap.get(name)!.push(p.user_id);
        }
      }

      if (councilMap.size === 0) {
        logger.warn("Fan-out: no users have council preferences configured — aborting");
        return { leads_found: 0, email_sent: false };
      }

      logger.info(
        `Fan-out: ${councilMap.size} unique council(s) across ${profiles?.length ?? 0} user(s)`,
      );

      // 3. Translate council names → PlanIT auth codes (reuses existing helper)
      const fanOutCouncilList = buildCouncilList([...councilMap.keys()]);

      // 4. Scrape each council once, pass fanOutUserIds so process-council fans out
      const allLeads: MergedLead[] = [];
      for (const council of fanOutCouncilList) {
        const fanOutUserIds = councilMap.get(council.name) ?? [];
        logger.info(`Fan-out: triggering ${council.name} → ${fanOutUserIds.length} user(s)`);
        try {
          const result = await processCouncilTask.triggerAndWait({
            council_name: council.name,
            council_auth: council.auth,
            fanOutUserIds,
          });
          if (result.ok) {
            allLeads.push(...(result.output.leads ?? []));
          } else {
            logger.error(`Fan-out: ${council.name} task failed`, { error: result.error });
          }
        } catch (e) {
          logger.error(`Fan-out: ${council.name} threw`, { error: e });
        }
      }

      logger.info(`Fan-out complete. Total leads: ${allLeads.length}`);

      if (allLeads.length === 0) {
        logger.info("Fan-out: no leads — skipping email");
        return { leads_found: 0, email_sent: false };
      }

      // 5. Send digest email (same as single-user path below)
      const resend = new Resend(process.env.RESEND_API_KEY);
      const html = buildEmailHtml(allLeads, runDate);
      const subject = `🏗️ Planning Leads — ${runDate} (${allLeads.length} leads, ${allLeads.filter((l) => l.priority === "HIGH").length} HIGH)`;
      const emailResult = await resend.emails.send({
        from: "Planning Leads <onboarding@resend.dev>",
        to: process.env.DIGEST_EMAIL ?? "nicomistry@gmail.com",
        subject,
        html,
      });

      if (emailResult.error) {
        logger.error("Fan-out: email failed", { error: emailResult.error });
      } else {
        logger.info(`Fan-out: ✉ email sent`, { id: emailResult.data?.id });
      }

      return {
        leads_found: allLeads.length,
        high_priority: allLeads.filter((l) => l.priority === "HIGH").length,
        email_sent: !emailResult.error,
        email_id: emailResult.data?.id,
      };
    }
    // ── End fan-out mode ───────────────────────────────────────────────────────

    // Use user's selected councils if provided, otherwise fall back to defaults
    const councilList =
      councils && councils.length > 0
        ? buildCouncilList(councils)
        : DEFAULT_COUNCILS;

    logger.info(`Planning scraper started — ${runDate}`);
    logger.info(`Councils to process: ${councilList.map((c) => c.name).join(", ")}`);

    const allLeads: MergedLead[] = [];

    // Process each council sequentially via triggerAndWait
    for (const council of councilList) {
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
