import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  grantWelcomeCredits,
  ensureWelcomeCredits,
  getCreditBalance,
  consumeCredit,
  WELCOME_CREDITS,
} from '../credits';

let db: D1Memory;

beforeAll(() => {
  db = new D1Memory();
});

afterAll(() => {
  db.close();
});

describe('welcome credits (registration perk)', () => {
  it('grants the configured one-time credits to a new account', async () => {
    await grantWelcomeCredits('u1', db as never);
    expect(await getCreditBalance('u1', db as never)).toEqual({
      '3card': WELCOME_CREDITS['3card'],
      celtic_cross: WELCOME_CREDITS.celtic_cross,
    });
    expect(WELCOME_CREDITS).toEqual({ '3card': 3, celtic_cross: 1 });
  });

  it('never re-grants: repeated calls keep the balance unchanged', async () => {
    await consumeCredit('u1', '3card', db as never);
    await grantWelcomeCredits('u1', db as never);
    await ensureWelcomeCredits('u1', db as never);
    expect(await getCreditBalance('u1', db as never)).toEqual({
      '3card': WELCOME_CREDITS['3card'] - 1,
      celtic_cross: WELCOME_CREDITS.celtic_cross,
    });
  });

  it('returns zero balance for unknown users', async () => {
    expect(await getCreditBalance('nobody', db as never)).toEqual({ '3card': 0, celtic_cross: 0 });
  });

  it('consumeCredit decrements only the drawn spread and floors at zero', async () => {
    await grantWelcomeCredits('u2', db as never);
    await consumeCredit('u2', 'celtic_cross', db as never);
    expect(await getCreditBalance('u2', db as never)).toEqual({
      '3card': WELCOME_CREDITS['3card'],
      celtic_cross: 0,
    });
    // drawing celtic again without credits must not go negative
    await consumeCredit('u2', 'celtic_cross', db as never);
    expect((await getCreditBalance('u2', db as never)).celtic_cross).toBe(0);
  });

  it('balances are independent per user', async () => {
    await grantWelcomeCredits('u3', db as never);
    await consumeCredit('u3', '3card', db as never);
    await consumeCredit('u3', '3card', db as never);
    expect((await getCreditBalance('u1', db as never))['3card']).toBe(WELCOME_CREDITS['3card'] - 1);
    expect((await getCreditBalance('u3', db as never))['3card']).toBe(WELCOME_CREDITS['3card'] - 2);
  });
});
