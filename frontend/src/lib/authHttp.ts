// API へのリクエストにアクセストークンを付与するインターセプター
// - 付与するのは自サービスの API（同一オリジンの /api/ 配下、または VITE_API_BASE_URL のオリジン）宛てのみ
// - 401 の場合はトークンを 1 回だけ更新して再送し、それでも 401 ならローカルのログイン情報を削除する
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import type { User } from "oidc-client-ts";
import { API_BASE_URL } from "./config";

// インターセプターが利用する UserManager の機能（テストでは差し替える）
export type TokenSource = {
  getUser: () => Promise<User | null>;
  signinSilent: () => Promise<User | null>;
  removeUser: () => Promise<void>;
};

type AuthRequestConfig = InternalAxiosRequestConfig & {
  _authAttached?: boolean;
  _authRetried?: boolean;
};

export type AuthInterceptorOptions = {
  apiBaseUrl?: string;
  origin?: string;
  onSessionExpired?: () => void;
};

// リクエスト先が自サービスの API かどうか
export function isApiRequestUrl(
  requestUrl: string | undefined,
  baseURL: string | undefined,
  apiBaseUrl: string = API_BASE_URL,
  origin: string = window.location.origin
): boolean {
  if (!requestUrl) return false;
  let target: URL;
  try {
    const base = baseURL ? new URL(baseURL, origin).toString() : origin;
    target = new URL(requestUrl, base);
  } catch {
    return false;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  const appOrigin = new URL(origin).origin;
  if (target.origin === appOrigin) return target.pathname.startsWith("/api/");
  if (!apiBaseUrl) return false;
  try {
    return target.origin === new URL(apiBaseUrl, origin).origin;
  } catch {
    return false;
  }
}

function usableToken(user: User | null): string | null {
  if (!user || user.expired || !user.access_token) return null;
  return user.access_token;
}

const installed = new WeakSet<object>();

export function setupAuthInterceptors(
  instance: AxiosInstance,
  getSource: () => TokenSource | null,
  options: AuthInterceptorOptions = {}
): void {
  if (!instance?.interceptors?.request || installed.has(instance)) return;
  installed.add(instance);
  const isApi = (config: InternalAxiosRequestConfig) =>
    isApiRequestUrl(config.url, config.baseURL, options.apiBaseUrl ?? API_BASE_URL, options.origin ?? window.location.origin);

  // 同時に複数のリクエストが 401 になっても、トークンの更新は 1 回にまとめる
  let renewing: Promise<string | null> | null = null;
  const renewToken = (source: TokenSource): Promise<string | null> => {
    if (!renewing) {
      renewing = source
        .signinSilent()
        .then(usableToken)
        .catch(() => null)
        .finally(() => {
          renewing = null;
        });
    }
    return renewing;
  };

  instance.interceptors.request.use(async (config: AuthRequestConfig) => {
    const source = getSource();
    if (!source || !isApi(config) || config.headers?.has?.("Authorization")) return config;
    const token = usableToken(await source.getUser().catch(() => null));
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
      config._authAttached = true;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error?.config as AuthRequestConfig | undefined;
      const source = getSource();
      if (!source || !config || error.response?.status !== 401 || !config._authAttached) {
        return Promise.reject(error);
      }
      if (!config._authRetried) {
        config._authRetried = true;
        const token = await renewToken(source);
        if (token) {
          config.headers.set("Authorization", `Bearer ${token}`);
          return instance.request(config);
        }
      }
      // 更新できない、または更新後も 401 の場合はログアウト状態に戻す
      await source.removeUser().catch(() => undefined);
      options.onSessionExpired?.();
      return Promise.reject(error);
    }
  );
}
