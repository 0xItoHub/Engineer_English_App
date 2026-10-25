// Amazon Cognito によるログイン（OAuth 2.0 認可コード + PKCE）の設定と共通処理
// - 接続先はすべてビルド時の環境変数で指定する（未設定の場合はログイン機能を表示せず、匿名で利用する）
// - トークンは sessionStorage（タブを閉じると破棄）に保存し、localStorage には保存しない
import { useContext } from "react";
import { AuthContext } from "react-oidc-context";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

// ログイン後に戻ってくるパス（SPA 側でこのルートを処理する）
export const CALLBACK_PATH = "/auth/callback";

export type CognitoConfig = {
  authority: string;
  clientId: string;
  domain: string;
};

type CognitoEnv = {
  VITE_COGNITO_AUTHORITY?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_COGNITO_DOMAIN?: string;
};

// 環境変数から Cognito の設定を読み込む（必要な値がそろっていない場合は null）
export function readCognitoConfig(env: CognitoEnv = import.meta.env): CognitoConfig | null {
  const authority = env.VITE_COGNITO_AUTHORITY?.trim() ?? "";
  const clientId = env.VITE_COGNITO_CLIENT_ID?.trim() ?? "";
  const domain = (env.VITE_COGNITO_DOMAIN?.trim() ?? "").replace(/\/+$/, "");
  if (!authority || !clientId || !domain) return null;
  return { authority, clientId, domain };
}

export const cognitoConfig = readCognitoConfig();
export const isAuthEnabled = cognitoConfig !== null;

// UserManager の設定（リダイレクト先は配信中のオリジンから組み立てる）
export function createUserManager(config: CognitoConfig, origin: string = window.location.origin): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    scope: "openid email profile",
    // アクセストークンの期限が近づいたら、リフレッシュトークンで自動的に更新する
    automaticSilentRenew: true,
    // トークンとログイン途中の状態は、どちらもタブ単位の sessionStorage に保存する
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    requestTimeoutInSeconds: 15,
  });
}

let userManager: UserManager | null = null;

// アプリ全体で共有する UserManager（ログイン機能が無効な場合は null）
export function getUserManager(): UserManager | null {
  if (!cognitoConfig) return null;
  if (!userManager) userManager = createUserManager(cognitoConfig);
  return userManager;
}

// Cognito のログアウト URL（ホストされたログイン画面のセッションも終了させる）
export function buildLogoutUrl(config: CognitoConfig, origin: string = window.location.origin): string {
  const params = new URLSearchParams({ client_id: config.clientId, logout_uri: `${origin}/` });
  return `${config.domain}/logout?${params.toString()}`;
}

// ページ全体の移動（テストでは差し替える）
export const pageNavigation = {
  assign: (url: string) => window.location.assign(url),
};

// ---- ログイン後の戻り先 ----

const MAX_RETURN_PATH_LENGTH = 2048;

// 戻り先として許可するのは、同一オリジン内の相対パス（"/" で始まり "//" で始まらないもの）のみ
export function sanitizeReturnPath(value: unknown, origin: string = window.location.origin): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RETURN_PATH_LENGTH) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // バックスラッシュや制御文字は、ブラウザによって別のオリジンとして解釈されることがあるため受け付けない
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin) return "/";
    if (url.pathname === CALLBACK_PATH) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export type SigninState = { returnTo?: string };

// ログイン完了時に保存しておいた戻り先を取り出す
export function returnPathFromUser(user: User | undefined | null): string {
  const state = user?.state as SigninState | undefined;
  return sanitizeReturnPath(state?.returnTo);
}

// ---- セッション切れの通知 ----

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

// ---- 画面から使うログイン状態 ----

export type AppAuth = {
  // ログイン機能が有効か（環境変数がそろっているか）
  enabled: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  // ユーザーの識別子（キャッシュをユーザーごとに分けるために使う）
  sub: string | null;
  email: string | null;
  error: Error | null;
  signIn: (returnTo?: string) => Promise<void>;
  // ローカルのログイン情報を削除してから、Cognito のログアウト画面へ移動する
  signOut: () => Promise<void>;
};

const noop = async () => {};

const ANONYMOUS: AppAuth = {
  enabled: false,
  isLoading: false,
  isAuthenticated: false,
  sub: null,
  email: null,
  error: null,
  signIn: noop,
  signOut: noop,
};

// AuthProvider の外（ログイン機能が無効な場合）でも利用できるログイン状態のフック
export function useAppAuth(): AppAuth {
  const ctx = useContext(AuthContext);
  if (!ctx || !cognitoConfig) return ANONYMOUS;
  const user = ctx.user && !ctx.user.expired ? ctx.user : null;
  const email = typeof user?.profile?.email === "string" ? user.profile.email : null;
  const config = cognitoConfig;
  return {
    enabled: true,
    isLoading: ctx.isLoading,
    isAuthenticated: ctx.isAuthenticated && !!user,
    sub: user?.profile?.sub ?? null,
    email,
    error: ctx.error ?? null,
    signIn: async (returnTo?: string) => {
      const state: SigninState = { returnTo: sanitizeReturnPath(returnTo) };
      await ctx.signinRedirect({ state });
    },
    signOut: async () => {
      await ctx.removeUser();
      pageNavigation.assign(buildLogoutUrl(config));
    },
  };
}
