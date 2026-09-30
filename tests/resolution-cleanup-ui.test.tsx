import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValidationResults } from "../src/components/ValidationResults";
import type { ValidationIssue } from "../src/lib/types";

const resolutionIssues: ValidationIssue[] = Array.from({ length: 9 }, (_, i) => ({
  type: "resolution", filename: `image (${i}).jpg`, reason: "Resolution is 1024x572, expected 2560x1440.",
}));
function render(issues: ValidationIssue[], isDeleting = false) {
  return renderToStaticMarkup(<ValidationResults issues={issues} isDeleting={isDeleting}
    onSuccess={vi.fn()} onReset={vi.fn()} onDeleteResolutionErrors={vi.fn()}
    imageCount={issues.length + 2} annotationCount={issues.length + 2} />);
}

describe("resolution cleanup controls", () => {
  it("shows individual actions, dynamic bulk counts, and dataset counts", () => {
    const nine = render(resolutionIssues);
    expect(nine).toContain("Delete All 9 Resolution Error Files");
    expect(nine.match(/aria-label="Delete image/g)).toHaveLength(9);
    expect(nine).toContain("Images: 11 | Annotations: 11");
    const eight = render(resolutionIssues.slice(1));
    expect(eight).toContain("Delete All 8 Resolution Error Files");
    expect(eight.match(/aria-label="Delete image/g)).toHaveLength(8);
    expect(eight).toContain("Images: 10 | Annotations: 10");
    expect(nine).toContain("Fix the issues below or remove invalid files to continue.");
  });

  it("hides bulk deletion with no resolution errors and allows continuing when valid", () => {
    const valid = render([]);
    expect(valid).toContain("Continue");
    expect(valid).not.toContain("Delete All");
    const unrelated = render([{ type: "orphaned-image", filename: "orphan.jpg", reason: "Missing annotation" }]);
    expect(unrelated).toContain("Missing annotation");
    expect(unrelated).not.toContain("Delete All");
    expect(unrelated).not.toContain(">Continue<");
  });

  it("disables all delete and re-upload controls while revalidating", () => {
    const markup = render(resolutionIssues, true);
    expect(markup.match(/disabled=""/g)).toHaveLength(11);
    expect(markup).toContain("Deleting files and revalidating...");
  });
});
