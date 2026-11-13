import { ToolRegistry, type ToolName } from "../tools/registry.ts";
import type { ToolEnvelope } from "../tools/protocol.ts";

export interface RiskClassification { tier: 0 | 1 | 2 | 3; summary: string; consequence: string; reason: string }

const blockedLanguage = /\b(buy(?:\s+now)?|purchase|checkout|pay(?:\s+now)?|place order|transfer|delete|destroy|revoke|change\s+(?:your\s+)?password|accept\s+(?:the\s+)?(?:terms|agreement)|sign\s+(?:the\s+)?contract|submit\s+order)\b/i;
const sensitiveField = /\b(password|passcode|api.?key|secret|token|cookie|authorization|credit.?card|cvv|ssn|social security)\b/i;
const sensitivePath = /\/(checkout|billing|payment|account\/security|settings\/tokens|transfer|admin)(\/|$)/i;

export interface ObservedTarget {
  id: string; tagName: string; role: string; name: string; type?: string; href?: string;
  placeholder?: string; disabled: boolean;
}

/** Deterministic policy gate. Model-provided labels never lower a registered tool's base tier. */
export class PolicyEngine {
  classifyActionRisk(envelope: ToolEnvelope, currentUrl: string, allowedOrigins: ReadonlySet<string>, target?: ObservedTarget): RiskClassification & { blocked?: boolean } {
    const tool = envelope.tool as ToolName;
    const definition = ToolRegistry[tool];
    if (!definition) return { tier: 3, blocked: true, summary: "Unknown browser action", consequence: "The action is not registered.", reason: "Unknown tool is blocked." };
    const args = envelope.arguments;
    const destination = typeof args.url === "string" ? args.url : undefined;
    if (!this.isInScope(currentUrl, allowedOrigins) || (destination && !this.isInScope(destination, allowedOrigins))) {
      return { tier: 3, blocked: true, summary: `Blocked ${tool}`, consequence: "This action leaves the task's approved origin scope.", reason: "Origin scope violation." };
    }
    const context = [envelope.reason, envelope.expectedOutcome, target?.name, target?.placeholder, target?.type].filter(Boolean).join(" ");
    if (target?.disabled) return { tier: 3, blocked: true, summary: "Blocked disabled control", consequence: "The target is disabled and cannot be safely activated.", reason: "Disabled target." };
    if (target && sensitiveField.test(`${target.name} ${target.placeholder ?? ""} ${target.type ?? ""}`) && tool === "type_text") {
      return { tier: 3, blocked: true, summary: "Blocked sensitive field entry", consequence: "Atlas will not type credentials or payment data into a page.", reason: "Sensitive target field." };
    }
    if ((tool === "click_element" || tool === "press_key") && blockedLanguage.test(context)) {
      return { tier: 3, blocked: true, summary: `Blocked high-impact ${tool}`, consequence: "Financial, credential, legal, or account destructive actions are blocked by default.", reason: "High-impact target or action language." };
    }
    const tier = definition.riskTier;
    if (tool === "click_element") {
      if (target?.href) {
        let targetUrl: URL;
        try { targetUrl = new URL(target.href); } catch { return { tier: 3, blocked: true, summary: "Blocked invalid link", consequence: "The destination URL is invalid.", reason: "Invalid observed link." }; }
        if (!(targetUrl.protocol === "https:" || (targetUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname))) || !allowedOrigins.has(targetUrl.origin)) {
          return { tier: 3, blocked: true, summary: "Blocked out-of-scope link", consequence: "The observed link leaves the task's approved origin scope.", reason: "Link destination violates origin policy." };
        }
        return { tier: 1, summary: `Open ${targetUrl.host}${targetUrl.pathname}`, consequence: "This follows an in-scope link.", reason: "Observed link destination is in scope." };
      }
      const highRiskPath = sensitivePath.test(new URL(currentUrl).pathname);
      const tier: 2 | 3 = highRiskPath ? 3 : 2;
      if (highRiskPath) return { tier: 3, blocked: true, summary: "Blocked click on sensitive account page", consequence: "Actions on payment, security, transfer, and admin pages are blocked by default.", reason: "Sensitive page path." };
      return { tier, summary: `Review click: ${target?.name || envelope.reason.slice(0, 160)}`, consequence: `Click the observed ${target?.tagName ?? "page"} control${highRiskPath ? " on a sensitive account or payment page" : ""}.`, reason: "Button actions require explicit approval." };
    }
    if (tool === "type_text" || tool === "select_option" || (tool === "press_key" && ["Enter", "Delete", "Backspace", "Space"].includes(String(envelope.arguments.key)))) {
      return { tier: 2, summary: `${tool === "type_text" ? "Enter text" : tool === "select_option" ? "Change selection" : "Press key"}${target?.name ? ` in ${target.name}` : ""}`, consequence: "This changes form or page state and requires approval.", reason: "Page state mutation requires approval." };
    }
    return {
      tier,
      summary: `${tool}: ${envelope.reason.slice(0, 200)}`,
      consequence: tier >= 2 ? "This action changes page data or performs a consequential operation." : "This action is limited to the approved browsing scope.",
      reason: `Registered risk tier ${tier}.`,
    };
  }

  isInScope(url: string, origins: ReadonlySet<string>): boolean {
    try { return origins.has(new URL(url).origin); } catch { return false; }
  }
}
