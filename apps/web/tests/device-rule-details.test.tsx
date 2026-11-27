// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DeviceRuleDetails } from "@/components/drawing/device-rule-details";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
afterEach(cleanup);
const device = { ...DEMO_RESULT.devices[0], ruleId: "r1" };
const rule = { id: "r1", rule: "Office height", value: "test value", document: "Test document", clause: "Test clause", status: "needs_verification" };
it.each([null, undefined])("clears verified provenance after editing when ruleId is %s", (ruleId) => {
  const rules = [{ ...rule, status: "verified" }];
  const view = render(<DeviceRuleDetails device={device} rules={rules} />);
  expect(screen.getByText("✓ Правило перевірено")).toBeVisible();
  view.rerender(<DeviceRuleDetails device={{ ...device, ruleId }} rules={rules} />);
  expect(screen.queryByText(/Правило перевірено/)).toBeNull();
  expect(screen.getByText("? Статус правила невідомий")).toBeVisible();
  expect(screen.queryByText("Test document")).toBeNull();
});
it("shows exact rule provenance and review reason without claiming a violation", () => {
  render(<DeviceRuleDetails device={device} rules={[rule]} />);
  expect(screen.getByText("? Треба перевірити")).toBeVisible();
  expect(screen.getByText("Test clause")).toBeVisible();
  expect(screen.getByText(/не є підтвердженим порушенням/)).toBeVisible();
});
it("keeps absent or mismatched provenance unknown instead of borrowing another rule", () => {
  render(<DeviceRuleDetails device={device} rules={[{ ...rule, id: "other", status: "verified" }]} />);
  expect(screen.getByText("? Статус правила невідомий")).toBeVisible();
  expect(screen.queryByText("Test document")).toBeNull();
});
it("shows verified status and guards rule navigation during an editor lock", () => {
  render(<DeviceRuleDetails device={device} rules={[{ ...rule, status: "verified" }]} blocked />);
  expect(screen.getByText("✓ Правило перевірено")).toBeVisible();
  const link = screen.getByRole("link", { name: "Перейти до правил" });
  expect(link).toHaveAttribute("aria-disabled", "true");
  expect(fireEvent.click(link)).toBe(false);
});
