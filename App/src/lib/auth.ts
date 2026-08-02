import * as SecureStore from 'expo-secure-store';

export type Restaurant = {
  id: number;
  name: string;
  slug: string;
};

export type Session = {
  baseUrl: string;
  token: string;
  restaurant: Restaurant;
  email: string;
  name: string;
  role: string;
  /** True for developer/superuser accounts — gates dev-only UI. */
  isDev: boolean;
};

const SESSION_KEY = 'prime.session';

type LoginResponse = {
  id: number;
  email: string;
  name: string;
  role: string;
  restaurant: Restaurant;
  token: string;
  isDev?: boolean;
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Authenticate against the backend and build a Session.
 * Throws a readable Error on failure (uses the response `detail` when present).
 */
export async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<Session> {
  const base = stripTrailingSlash(baseUrl.trim());

  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('تعذّر الاتصال بالخادم. تحقق من الرابط واتصال الإنترنت.');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : null;
    if (res.status === 400 || res.status === 401) {
      throw new Error(detail ?? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }
    throw new Error(detail ?? `فشل تسجيل الدخول (${res.status}).`);
  }

  const body = data as LoginResponse;
  return {
    baseUrl: base,
    token: body.token,
    restaurant: body.restaurant,
    email: body.email,
    name: body.name,
    role: body.role,
    isDev: body.isDev ?? false,
  };
}

export async function saveSession(s: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
