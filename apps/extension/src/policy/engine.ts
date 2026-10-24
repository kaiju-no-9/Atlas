import { ToolRegistry, type ToolName } from "../tools/registry.ts";
import type { ToolEnvelope } from "../tools/protocol.ts";

export interface RiskClassification { tier: 0 | 1 | 2 | 3; summary: string; consequence: string; reason: string }

const destructiveLanguage = /\b(buy|purchase|checkout|pay|place order|submit|send|delete|remove|transfer|publish|post|cancel subscription)\b/i;

/** Deterministic policy gate. Model-provided labels never lower a registered tool's base tier. */
export class PolicyEngine {
  classifyActionRisk(envelope: ToolEnvelope, currentUrl: string, allowedOrigins: ReadonlySet<string>): RiskClassification {
    const tool = envelope.tool as ToolName;
    const definition = ToolRegistry[tool];
    if (!definition) return { tier: 3, summary: "Unknown browser action", consequence: "The action is not registered.", reason: "Unknown tool is blocked." };
    const args = envelope.arguments;
    const destination = typeof args.url === "string" ? args.url : undefined;
    if (!this.isInScope(currentUrl, allowedOrigins) || (destination && !this.isInScope(destination, allowedOrigins))) {
      return { tier: 3, summary: `Out-of-scope ${tool}`, consequence: "This action leaves the task's approved origin scope.", reason: "Origin scope violation." };
    }
    if ((tool === "click_element" || tool === "press_key") && destructiveLanguage.test(`${envelope.reason} ${envelope.expectedOutcome}`)) {
      return { tier: 3, summary: `High-impact ${tool}: ${envelope.reason.slice(0, 200)}`, consequence: "May submit, send, publish, purchase, or irreversibly change page data.", reason: "High-impact action language requires explicit approval." };
    }
    const tier = definition.riskTier;
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
