import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VisualGenerationError } from "./VisualGenerationError";
import { VisualRenderer } from "./VisualRenderer";

describe("actionable picture failures", () => {
  it("provides credits, key-settings, and picture retry controls for payment errors", () => {
    const html = renderToStaticMarkup(<VisualGenerationError message="Insufficient credits" code="credits_required" kind="picture" onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="https://openrouter.ai/settings/credits"');
    expect(html).toContain('href="#/settings"');
    expect(html).toContain("Retry picture");
    expect(html).toContain("funded key");
  });

  it("replaces a legacy raw billing response with clean guidance", () => {
    const html = renderToStaticMarkup(<VisualGenerationError kind="picture" message={'Picture generation HTTP 402: {"error":{"message":"Insufficient credits", "secret":"private"}}'} />);
    expect(html).toContain("Picture generation needs OpenRouter credits");
    expect(html).not.toContain("HTTP 402");
    expect(html).not.toContain("private");
  });

  it("retains actionable credit guidance on a persisted failed image after refresh", () => {
    const html = renderToStaticMarkup(<VisualRenderer visual={{ type: "image", status: "failed", spec: null, error: { code: "credits_required", message: "Add image credits." } }} />);
    expect(html).toContain("Add credits");
    expect(html).toContain("Check API key");
  });

  it("shows picture model settings for configuration errors", () => {
    const html = renderToStaticMarkup(<VisualGenerationError message="Choose an image-capable model." code="model_unavailable" kind="picture" onRetry={() => {}} />);
    expect(html).toContain("Choose an image-capable model");
    expect(html).toContain("Open AI settings");
    expect(html).not.toContain("Add credits");
  });
});
