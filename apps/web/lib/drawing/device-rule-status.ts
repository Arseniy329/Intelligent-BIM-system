import type { Device } from "@bim/contracts";
import type { Rule } from "@/lib/api/rules";

export type DeviceRuleState = "verified" | "needs_review" | "unknown";
export function deviceRuleState(device: Pick<Device, "ruleId">, rules: readonly Rule[]): DeviceRuleState {
  if (!device.ruleId) return "unknown";
  const rule = rules.find(item => item.id === device.ruleId);
  if (rule?.status === "verified") return "verified";
  if (rule?.status === "needs_verification" || rule?.status === "needs_review") return "needs_review";
  return "unknown";
}
export const RULE_STATE_LABELS: Record<DeviceRuleState, string> = {
  verified: "Правило перевірено",
  needs_review: "Треба перевірити",
  unknown: "Статус правила невідомий",
};
