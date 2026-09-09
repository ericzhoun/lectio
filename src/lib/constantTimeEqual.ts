// Shared by every place that compares an attacker-suppliable value against a
// server-computed secret (mail tokens, webhook signatures): a length-aware
// early return is fine (it leaks nothing an attacker can act on - lengths
// here are fixed by the algorithm, not by guessable content), but comparing
// byte-by-byte with a short-circuiting === would leak how many leading bytes
// matched through timing. XOR-and-OR every position so the loop always runs
// to completion.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
