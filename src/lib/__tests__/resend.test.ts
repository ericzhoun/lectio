import { describe, expect, it, vi } from 'vitest';
import { sendBatch, FROM_ADDRESS } from '../resend';
import type { OutgoingMail } from '../resend';

function mail(to: string): OutgoingMail {
  return {
    to,
    subject: 'A word for today',
    html: '<p>hello</p>',
    text: 'hello',
    unsubscribeUrl: `https://enjoyhim.org/unsubscribe?e=${encodeURIComponent(to)}&t=tok`,
  };
}

function okFetch() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 })
  );
}

describe('sendBatch', () => {
  it('posts to the batch endpoint with the project from-address', async () => {
    const fetchImpl = okFetch();
    await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails/batch');
    expect(init.headers.Authorization).toBe('Bearer key-123');
    const body = JSON.parse(init.body);
    expect(body[0].from).toBe(FROM_ADDRESS);
    expect(body[0].to).toEqual(['reader@example.test']);
  });

  it('attaches one-click unsubscribe headers so mail clients show the button', async () => {
    const fetchImpl = okFetch();
    await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body[0].headers['List-Unsubscribe']).toBe(
      '<https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=tok>'
    );
    expect(body[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('chunks at 100 messages per call', async () => {
    const fetchImpl = okFetch();
    const many = Array.from({ length: 250 }, (_, i) => mail(`r${i}@example.test`));
    const result = await sendBatch(many, 'key-123', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toHaveLength(50);
    expect(result.delivered).toHaveLength(250);
    expect(result.failed).toHaveLength(0);
  });

  it('reports a rejected chunk as failed instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const result = await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.delivered).toEqual([]);
    expect(result.failed).toEqual(['reader@example.test']);
  });

  it('keeps a good chunk when a later chunk fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const many = Array.from({ length: 150 }, (_, i) => mail(`r${i}@example.test`));
    const result = await sendBatch(many, 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.delivered).toHaveLength(100);
    expect(result.failed).toHaveLength(50);
  });

  it('reports a network error as failed rather than escaping to the caller', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.failed).toEqual(['reader@example.test']);
  });
});
