// src/pages/api/auth/logout.ts
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('session', { path: '/' });
  return redirect('/');
};
