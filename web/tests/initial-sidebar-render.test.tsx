import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/MemoExplorer", () => ({
  MemoExplorer: () => <div data-testid="memo-explorer" />,
  MemoExplorerDrawer: () => <div data-testid="memo-explorer-drawer" />,
}));
vi.mock("@/components/MobileHeader", () => ({ default: () => <div /> }));
vi.mock("@/connect", () => ({ userServiceClient: { getUser: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/steven" }) }));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
vi.mock("@/hooks/useFilteredMemoStats", () => ({
  useFilteredMemoStats: () => ({ statistics: { activityStats: {}, timeBasis: "create_time" }, tags: {} }),
}));
vi.mock("@/hooks/useOpenLastDocument", () => ({ useOpenLastDocument: () => vi.fn() }));
vi.mock("@/router", () => ({
  Routes: { HOME: "/", DASHBOARD: "/dashboard", SHORTCUTS: "/shortcuts", EXPLORE: "/explore", ARCHIVED: "/archived" },
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

import MainLayout from "@/layouts/MainLayout";
import RootRedirect from "@/pages/RootRedirect";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<RootRedirect />} />
          <Route path="explore" element={<div>Explore page</div>} />
          <Route path="shortcuts" element={<div>Shortcuts page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("initial secondary sidebar", () => {
  it("shows a loading skeleton without the old memo explorer while / resolves", () => {
    renderAt("/");

    expect(screen.getByRole("status")).toHaveTextContent("common.loading");
    expect(screen.queryByTestId("memo-explorer")).not.toBeInTheDocument();
  });

  it("keeps the memo explorer on the Explore page", () => {
    renderAt("/explore");

    expect(screen.getByTestId("memo-explorer")).toBeInTheDocument();
  });

  it("keeps the memo explorer on the Shortcuts page", () => {
    renderAt("/shortcuts");

    expect(screen.getByTestId("memo-explorer")).toBeInTheDocument();
  });
});
