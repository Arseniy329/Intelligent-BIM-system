import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Rule } from "@/lib/api/rules";
import { deviceRuleState } from "@/lib/drawing/device-rule-status";
import { DeviceLegend } from "@/components/drawing/device-legend";
import { DeviceSymbol } from "@/components/drawing/device-symbol";
import { DEMO_RESULT } from "@/lib/drawing/demo-drawing";
import { parseDrawing } from "@/lib/drawing/drawing-api";

const rule = (status: string): Rule => ({ id: "rule-1", status, rule: "distance", value: "10", document: "DBN", clause: "1" });
describe("BIM-122 rule provenance", () => {
  it.each(["needs_review", "needs_verification"])("recognises %s without classifying a violation", status => {
    expect(deviceRuleState({ ruleId: "rule-1" }, [rule(status)])).toBe("needs_review");
  });
  it("requires the exact linked verified rule", () => {
    expect(deviceRuleState({ ruleId: "rule-1" }, [rule("verified")])).toBe("verified");
    for (const ruleId of [undefined, null, "different"]) expect(deviceRuleState({ ruleId }, [rule("verified")])).toBe("unknown");
    expect(deviceRuleState({ ruleId: "rule-1" }, [])).toBe("unknown");
    for (const status of ["pending", "", "future-state"]) expect(deviceRuleState({ ruleId: "rule-1" }, [rule(status)])).toBe("unknown");
  });
  it("retains provenance when reopening API results", () => {
    const result = { ...DEMO_RESULT, devices: [{ ...DEMO_RESULT.devices[0], ruleId: "rule-1" }] };
    expect(parseDrawing(result, result.drawing.id)).toEqual(result);
    expect(() => parseDrawing({ ...result, devices: [{ ...result.devices[0], ruleId: 12 }] }, result.drawing.id)).toThrow();
  });
  it("uses original assets consistently in legend and symbols, with live counts", () => {
    const devices = DEMO_RESULT.devices.map(d => ({ ...d, ruleId: "rule-1" }));
    const markup = renderToStaticMarkup(<DeviceLegend devices={devices} rules={[rule("verified")]} />);
    for (const type of ["smoke_detector", "heat_detector", "manual_call_point", "sounder"] as const) {
      expect(markup).toContain(`data-device-symbol="${type}"`);
      expect(renderToStaticMarkup(<DeviceSymbol type={type} />)).toContain("/design/bim-107/");
    }
    expect(markup).toContain("Димовий · 1");
    expect(markup).not.toContain("Статус правила невідомий");
    expect(renderToStaticMarkup(<DeviceLegend devices={DEMO_RESULT.devices} />)).toContain("Статус правила невідомий");
    expect(renderToStaticMarkup(<DeviceLegend />)).toContain("Димовий · 0");
    expect(renderToStaticMarkup(<DeviceSymbol type="future-device" />)).toContain('data-device-symbol="unknown"');
  });
});
