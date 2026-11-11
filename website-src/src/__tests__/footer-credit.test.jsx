// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Footer from "../components/Footer.jsx";

vi.mock("../hooks/useCatalog.jsx", () => ({ useCatalog: () => ({ catalog: null }) }));
afterEach(cleanup);

it("links only Sean's credit to the personal short URL while retaining source and feed links", () => {
  const { container } = render(<Footer />);
  const credit = screen.getByRole("link", { name: "Sean", exact: true });
  expect(credit.getAttribute("href")).toBe("https://s.vectorindex.cloud/sean");
  expect(credit.parentElement.textContent).toBe("Adapted by Sean with ❤️");
  expect(credit.parentElement.querySelectorAll("a")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "agent-skill-manager" }).getAttribute("href")).toBe("https://github.com/yuxiaoli/asm");
  expect(screen.getByRole("link", { name: "RSS" }).getAttribute("href")).toBe("rss.xml");
  expect(container.querySelector('a[href="https://www.linkedin.com/in/yuxiaoli/"]')).toBeNull();
});
