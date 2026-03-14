import { NextRequest, NextResponse } from 'next/server';
import { getSFTPClient, mapSFTPError, sanitizePath } from '@/lib/sftp';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'Missing required query parameter: path' }, { status: 400 });
    }

    const safePath = sanitizePath(path);
    const sftp = await getSFTPClient();

    const attrs = await new Promise<{ mode?: number }>((resolve, reject) => {
      sftp.stat(safePath, (err, stat) => {
        if (err) return reject(err);
        resolve(stat);
      });
    });

    const isDirectory = ((attrs.mode || 0) & 0o170000) === 0o040000;

    if (isDirectory) {
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(safePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(safePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    return NextResponse.json(
      {
        message: 'Resource deleted successfully',
        path: safePath,
      },
      { status: 200 }
    );
  } catch (err) {
    const mapped = mapSFTPError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
