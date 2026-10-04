import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VisualRenderer } from "./VisualRenderer";

describe("picture and visual lifecycle rendering", () => {
  it("renders a persisted picture with descriptive alt text and model attribution", () => {
    const html = renderToStaticMarkup(<VisualRenderer visual={{
      type: "image",
      status: "ready",
      spec: {
        data_url: "data:image/png;base64,iVBORw0KGgo=",
        media_type: "image/png",
        prompt: "Paint an educational illustration of the water cycle",
        alt: "Educational illustration: the water cycle",
        model: "test/image-model",
      },
    }} />);
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('alt="Educational illustration: the water cycle"');
    expect(html).toContain("test/image-model");
  });

  it("keeps pending and failed states visible before a visual type is selected", () => {
    const pending = renderToStaticMarkup(<VisualRenderer visual={{ type: "none", status: "generating", spec: null }} />);
    const failed = renderToStaticMarkup(<VisualRenderer visual={{ type: "none", status: "failed", spec: null }} error="No model responded" />);
    expect(pending).toContain("Generating visuals");
    expect(failed).toContain("No model responded");
    expect(renderToStaticMarkup(<VisualRenderer visual={null} />)).toBe("");
  });
});
