import "@github/relative-time-element";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "konsta/react";
import { lazy, type ReactNode, StrictMode, Suspense, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation, useParams } from "react-router-dom";
import "@/i18n";
import "./mobile.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { refreshAccessToken } from "@/connect";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InstanceProvider, useInstance } from "@/contexts/InstanceContext";
import { useTokenRefreshOnFocus } from "@/hooks/useTokenRefreshOnFocus";
import { queryClient } from "@/lib/query-client";
import { buildAuthRoute } from "@/utils/redirect-safety";
import TabsLayout from "./components/TabsLayout";
import { useSystemDarkMode } from "./lib/theme";
import FolderPage from "./pages/FolderPage";
import LoginPage from "./pages/LoginPage";
import MePage from "./pages/MePage";
import SearchPage from "./pages/SearchPage";
import ShelfPage from "./pages/ShelfPage";
import { docRoute, MOBILE_ROUTES } from "./routes";

// The reader pulls in the whole markdown renderer (highlighting, math, diagrams …). Loading it
// on first use keeps the shelf, search and sign-in pages light (requirement §8).
const ReaderPage = lazy(() => import("./pages/ReaderPage"));

/** Instance profile and session first, as the web app does; nothing renders until both are settled. */
function Bootstrap({ children }: { children: ReactNode }) {
  const { isInitialized: authReady, initialize: initAuth, currentUser } = useAuth();
  const { isInitialized: instanceReady, initialize: initInstance } = useInstance();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.all([initInstance(), initAuth()]);
  }, [initAuth, initInstance]);

  useTokenRefreshOnFocus(refreshAccessToken, !!currentUser);

  return authReady && instanceReady ? <>{children}</> : null;
}

function Root() {
  const dark = useSystemDarkMode();
  return (
    <App theme="ios" dark={dark} safeAreas>
      <Outlet />
      <ScrollRestoration />
    </App>
  );
}

/** Reading needs a session (requirement §3); anything else goes to sign-in and comes back. */
function RequireAuth() {
  const { currentUser } = useAuth();
  const location = useLocation();
  if (!currentUser) {
    return <Navigate to={buildAuthRoute({ redirect: `${location.pathname}${location.search}` })} replace />;
  }
  return <Outlet />;
}

/**
 * The renderer gives document links the web app's `/memos/{uid}` href; tapped, they are routed
 * in-app, but one opened another way (a new tab, a pasted link) lands here.
 */
function MemoRedirect() {
  const { uid = "" } = useParams();
  return <Navigate to={docRoute(`memos/${uid}`)} replace />;
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: MOBILE_ROUTES.AUTH, element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <TabsLayout />,
            children: [
              { path: MOBILE_ROUTES.SHELF, element: <ShelfPage /> },
              { path: MOBILE_ROUTES.SEARCH, element: <SearchPage /> },
              { path: MOBILE_ROUTES.ME, element: <MePage /> },
            ],
          },
          { path: "/kb/:uid/*", element: <FolderPage /> },
          {
            path: "/doc/:uid",
            element: (
              <Suspense fallback={<div className="min-h-full bg-white dark:bg-black" />}>
                <ReaderPage />
              </Suspense>
            ),
          },
          { path: "/memos/:uid", element: <MemoRedirect /> },
        ],
      },
      { path: "*", element: <Navigate to={MOBILE_ROUTES.SHELF} replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <AuthProvider>
            <Bootstrap>
              <RouterProvider router={router} />
            </Bootstrap>
          </AuthProvider>
        </InstanceProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
