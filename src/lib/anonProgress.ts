// Signed cookie that carries an anonymous reader's progress across sign-in.
//
// Anonymous readers may walk the first two steps (Silencio, Lectio) before the
// app asks them to sign in at Meditatio. Their walk leaves no session row —
// there is no user yet — so the session created after sign-in would otherwise
// start at Silencio and canOpenStep would bounce the reader back to the very
// beginning. The furthest step they genuinely reached travels in this cookie
// instead: it is signed with the session secret so it cannot be forged to skip
// ahead, pinned to the day it was recorded for, and consumed (read once, then
// cleared) the first time the signed-in session is created.
import { signJsonToken, readJsonToken } from './session';
import { isStep, type Step } from './dailySteps';

export const ANON_PROGRESS_COOKIE = 'anon_progress';
/** The cookie outlives any single sitting; the day check is what keeps it honest. */
export const ANON_PROGRESS_MAX_AGE = 60 * 60 * 24 * 7;

// Structural subset of AstroCookies, so the module stays unit-testable.
interface CookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: object): void;
  delete(name: string, options?: object): void;
}

/** Remember, for this day, the furthest step an anonymous reader has reached. */
export async function recordAnonProgress(
  cookies: CookieStore, day: string, step: Step, secret: string
): Promise<void> {
  if (!isStep(step)) return;
  const token = await signJsonToken({ v: 1, day, step }, secret);
  cookies.set(ANON_PROGRESS_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: ANON_PROGRESS_MAX_AGE,
  });
}

/**
 * Consume the recorded progress for this day: the step, and the cookie cleared.
 * A cookie signed for a different day is stale and yields nothing.
 */
export async function takeAnonProgress(
  cookies: CookieStore, day: string, secret: string
): Promise<Step | null> {
  const token = cookies.get(ANON_PROGRESS_COOKIE)?.value;
  if (!token) return null;
  cookies.delete(ANON_PROGRESS_COOKIE, { path: '/' });
  const data = await readJsonToken(token, secret);
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || d.day !== day || !isStep(d.step)) return null;
  return d.step;
}
