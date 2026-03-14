import { NextRequest, NextResponse } from 'next/server';
import { listDirectory, mapSFTPError, sanitizePath } from '@/lib/sftp';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'Missing required query parameter: path' }, { status: 400 });
    }

    const safePath = sanitizePath(path);
    const entries = await listDirectory(safePath);
    return NextResponse.json(entries, { status: 200 });
  } catch (err) {
    const mapped = mapSFTPError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
