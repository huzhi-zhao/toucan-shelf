import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Block, Button, List, ListInput, Page } from "konsta/react";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { setAccessToken } from "@/auth-state";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { useInstance } from "@/contexts/InstanceContext";
import { AUTH_REDIRECT_PARAM, getSafeRedirectPath } from "@/utils/redirect-safety";
import { COPY } from "../copy";
import { navigateWithTransition } from "../lib/nav";
import { MOBILE_ROUTES } from "../routes";

/** Username and password only (requirement §3). SSO is not offered on the phone. */
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { currentUser, initialize } = useAuth();
  const { generalSetting } = useInstance();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const redirect = getSafeRedirectPath(params.get(AUTH_REDIRECT_PARAM)) ?? MOBILE_ROUTES.HOME;

  if (currentUser) return <Navigate to={redirect} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await authServiceClient.signIn({
        credentials: { case: "passwordCredentials", value: { username, password } },
      });
      if (response.accessToken) {
        setAccessToken(response.accessToken, response.accessTokenExpiresAt ? timestampDate(response.accessTokenExpiresAt) : undefined);
      }
      await initialize();
      navigateWithTransition(() => navigate(redirect, { replace: true, flushSync: true }), "forward");
    } catch {
      setError(COPY.login.failed);
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <div className="flex flex-col items-center pt-[max(16vh,env(safe-area-inset-top))] pb-8">
        <img src="/logo.webp" alt="" className="w-20 h-20 rounded-[22px] shadow-lg object-cover" />
        <h1 className="mt-5 text-[28px] font-bold tracking-tight">{COPY.appName}</h1>
        <p className="mt-1 text-[15px] text-black/50 dark:text-white/50">{COPY.tagline}</p>
      </div>
      {generalSetting.disallowPasswordAuth ? (
        <Block strong inset className="text-[15px] leading-relaxed">
          {COPY.login.passwordDisabled}
        </Block>
      ) : (
        <form onSubmit={submit}>
          <List strongIos insetIos>
            <ListInput
              label={COPY.login.username}
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
            />
            <ListInput
              label={COPY.login.password}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
          </List>
          {error && <p className="px-8 -mt-2 text-[13px] text-red-500">{error}</p>}
          <Block>
            <Button large rounded component="button" disabled={submitting || !username || !password}>
              {submitting ? COPY.login.submitting : COPY.login.submit}
            </Button>
          </Block>
        </form>
      )}
    </Page>
  );
}
