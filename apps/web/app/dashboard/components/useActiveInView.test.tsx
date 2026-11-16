// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useActiveInView } from "./useActiveInView";

/** A strip 300 px wide holding 600 px of tabs, the current one at `left` (100 px wide). */
function layout({ scrollWidth = 600, left }: { scrollWidth?: number; left: number }) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [x, width] = this.dataset.strip !== undefined ? [0, 300] : [left, 100];
    return { left: x, right: x + width, width, top: 0, bottom: 44, height: 44, x, y: 0, toJSON: () => ({}) };
  });
}

function Strip({ current = "c", selector }: { current?: string; selector?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useActiveInView(ref, current, selector);
  return (
    <div ref={ref} data-strip="">
      {["a", "b", "c"].map((key) => (
        <a key={key} href={`#${key}`} aria-current={key === current ? "page" : undefined} data-active={key === "b" ? "" : undefined}>
          {key}
        </a>
      ))}
    </div>
  );
}

const strip = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-strip]")!;

afterEach(() => vi.restoreAllMocks());

describe("useActiveInView", () => {
  it("centres the current tab of a strip that scrolls", () => {
    layout({ left: 450 });
    const { container } = render(<Strip />);
    expect(strip(container).scrollLeft).toBe(350);
  });

  it("leaves a strip that fits alone (desktop)", () => {
    layout({ scrollWidth: 300, left: 450 });
    const { container } = render(<Strip />);
    expect(strip(container).scrollLeft).toBe(0);
  });

  it("leaves it alone when the current tab is already in view", () => {
    layout({ left: 150 });
    const { container } = render(<Strip />);
    expect(strip(container).scrollLeft).toBe(0);
  });

  it("scrolls again when the page changes, to the item a selector picks", () => {
    layout({ left: 450 });
    const { container, rerender } = render(<Strip selector="[data-active]" />);
    expect(strip(container).scrollLeft).toBe(350);
    strip(container).scrollLeft = 0;
    rerender(<Strip current="a" selector="[data-active]" />);
    expect(strip(container).scrollLeft).toBe(350);
  });
});
