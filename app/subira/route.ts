import { NextResponse } from 'next/server';

export function GET(): Response {
  return NextResponse.redirect('https://subira.kitabuyetu.co.ke/', {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
