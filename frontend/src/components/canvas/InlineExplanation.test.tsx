import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineExplanation } from "./InlineExplanation";

describe("inline concept explanations", () => {
  it("renders metadata highlights inside bold prose without leaking formatting markers", () => {
    const html = renderToStaticMarkup(<InlineExplanation text="The **water cycle** moves water through *evaporation*." keyTerms={["water cycle", "evaporation"]} onExplain={() => {}} />);
    expect(html).toContain('<strong><button');
    expect(html).toContain('aria-label="Explain water cycle"');
    expect(html).toContain('<em><button');
    expect(html).not.toContain("**");
    expect(html).toContain("nodrag nopan");
  });

  it("keeps explicit term markers interactive and safely escapes answer content", () => {
    const html = renderToStaticMarkup(<InlineExplanation text="[[Evaporation]] is not <script>alert(1)</script>." keyTerms={[]} onExplain={() => {}} />);
    expect(html).toContain('data-explain-term="Evaporation"');
    expect(html).not.toContain("[[");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("disables the native term buttons while an answer is being generated", () => {
    const html = renderToStaticMarkup(<InlineExplanation text="[[Evaporation]]" keyTerms={[]} onExplain={() => {}} disabled />);
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
  });
});
