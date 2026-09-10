// Entry point for the Daily Invitation's cron Worker. This is a separate
// Worker script from the site's own SSR Worker (see astro.config.mjs's
// auxiliaryWorkers entry and wrangler.cron.jsonc) - the installed
// @astrojs/cloudflare (v14.2.5) has no supported way to attach a `scheduled`
// export to the same Worker the adapter builds for `fetch`, so the cron lives
// here instead, sharing only the D1 binding and the two mail secrets it
// needs. All the actual decisions live in src/lib/sendDaily.ts, which is
// where the tests point.
import { sendDailyInvitations } from './lib/sendDaily';

export default {
  async scheduled(_controller: ScheduledController, env: any, ctx: ExecutionContext) {
    const apiKey = env.RESEND_API_KEY as string | undefined;
    const tokenSecret = env.MAIL_TOKEN_SECRET as string | undefined;
    if (!apiKey || !tokenSecret) {
      // Loud, but not a throw: a misconfigured secret should not turn every
      // hourly tick into a Cloudflare error alert.
      console.error('daily-invitation: RESEND_API_KEY or MAIL_TOKEN_SECRET missing; not sending');
      return;
    }

    ctx.waitUntil(
      sendDailyInvitations({ db: env.DB, now: new Date(), apiKey, tokenSecret })
        .then((result) =>
          console.log('daily-invitation: sent', result.sent, 'skipped', result.skipped)
        )
        .catch((e) => console.error('daily-invitation: send failed:', e))
    );
  },
};
