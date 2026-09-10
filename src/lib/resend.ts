// A deliberately small Resend client: one endpoint, no SDK, injectable fetch so
// tests never touch the network.
const BATCH_URL = 'https://api.resend.com/emails/batch';

/** Resend's documented ceiling for one batch call. */
const CHUNK_SIZE = 100;

export const FROM_ADDRESS = 'The Daily Invitation <lectio@enjoyhim.org>';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export interface BatchResult {
  delivered: string[];
  failed: string[];
}

function toPayload(mail: OutgoingMail) {
  return {
    from: FROM_ADDRESS,
    to: [mail.to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // These two headers are what make Gmail and Apple Mail offer a native
    // unsubscribe control, which readers use instead of the spam button.
    headers: {
      'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function sendBatch(
  messages: OutgoingMail[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<BatchResult> {
  const delivered: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetchImpl(BATCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.map(toPayload)),
      });
      if (!response.ok) {
        // Leave last_sent alone for these; dueNow's send window (06:00-09:00
        // local) means a later tick this same morning retries them.
        console.error(
          'daily-invitation: resend rejected a batch:',
          response.status,
          await response.text().catch(() => '')
        );
        failed.push(...chunk.map((m) => m.to));
        continue;
      }
      delivered.push(...chunk.map((m) => m.to));
    } catch (e) {
      console.error('daily-invitation: resend call threw:', e);
      failed.push(...chunk.map((m) => m.to));
    }
  }

  return { delivered, failed };
}
