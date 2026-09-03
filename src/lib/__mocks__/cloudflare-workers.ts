// Mock for cloudflare:workers module in tests
export const env = {
  DB: {
    exec: async () => {},
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        run: async () => {},
      }),
    }),
  },
};
