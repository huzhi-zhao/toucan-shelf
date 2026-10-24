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
import LoadingScreen from "./components/LoadingScreen";
import TabsLayout from "./components/TabsLayout";
import { useBlurTextFieldWhenHidden } from "./lib/keyboard";
import { forgetRouterTransitions, useRouteCommitSignal } from "./lib/nav";
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
// The planner reuses the calendar block's grid (and the web UI kit it is built with); same reasoning.
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const PlannerPage = lazy(() => import("./pages/planner/PlannerPage"));
const TodoPage = lazy(() => import("./pages/planner/TodoPage"));
const NotePage = lazy(() => import("./pages/planner/NotePage"));
const CheckInPage = lazy(() => import("./pages/planner/CheckInPage"));
const PlannerSettingsPage = lazy(() => import("./pages/planner/PlannerSettingsPage"));
const PlannerImportPage = lazy(() => import("./pages/planner/PlannerImportPage"));
const HabitVersionPage = lazy(() => import("./pages/planner/HabitVersionPage"));
const MeSettingsPage = lazy(() => import("./pages/MeSettingsPage"));
const MeItemPage = lazy(() => import("./pages/MeItemPage"));

/** A spinner while a lazy page's code loads, in the list background so the switch does not flash. */
const lazyPage = (page: ReactNode) => <Suspense fallback={<LoadingScreen />}>{page}</Suspense>;

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

  // mobile.html's spinner has already been up while the scripts loaded, so this one shows at once.
  return authReady && instanceReady ? <>{children}</> : <LoadingScreen delay={0} />;
}

function Root() {
  const dark = useSystemDarkMode();
  useRouteCommitSignal();
  useBlurTextFieldWhenHidden();
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

forgetRouterTransitions();

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
              { path: MOBILE_ROUTES.PLAN, element: lazyPage(<PlannerPage />) },
              { path: MOBILE_ROUTES.SHELF, element: <ShelfPage /> },
              { path: MOBILE_ROUTES.SEARCH, element: <SearchPage /> },
              { path: MOBILE_ROUTES.ME, element: <MePage /> },
            ],
          },
          { path: "/kb/:uid/*", element: <FolderPage /> },
          { path: MOBILE_ROUTES.FAVORITES, element: lazyPage(<FavoritesPage />) },
          { path: "/plan/todo/:uid", element: lazyPage(<TodoPage />) },
          { path: "/plan/note/:uid", element: lazyPage(<NotePage />) },
          { path: "/plan/checkin/:uid/:date", element: lazyPage(<CheckInPage />) },
          { path: MOBILE_ROUTES.PLAN_SETTINGS, element: lazyPage(<PlannerSettingsPage />) },
          { path: MOBILE_ROUTES.PLAN_IMPORT, element: lazyPage(<PlannerImportPage />) },
          { path: MOBILE_ROUTES.PLAN_VERSION, element: lazyPage(<HabitVersionPage />) },
          { path: MOBILE_ROUTES.ME_SETTINGS, element: lazyPage(<MeSettingsPage />) },
          { path: "/me/item/:id", element: lazyPage(<MeItemPage />) },
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
      { path: MOBILE_ROUTES.HOME, element: <Navigate to={MOBILE_ROUTES.PLAN} replace /> },
      { path: "*", element: <Navigate to={MOBILE_ROUTES.PLAN} replace /> },
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
