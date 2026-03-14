import { NextRequest, NextResponse } from 'next/server';
import { getSFTPClient, mapSFTPError, sanitizePath } from '@/lib/sftp';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { fromPath?: string; toPath?: string };
    if (!body.fromPath || !body.toPath) {
      return NextResponse.json(
        { error: 'Missing required fields: fromPath, toPath' },
        { status: 400 }
      );
    }

    const fromPath = sanitizePath(body.fromPath);
    const toPath = sanitizePath(body.toPath);

    const sftp = await getSFTPClient();
    await new Promise<void>((resolve, reject) => {
      sftp.rename(fromPath, toPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return NextResponse.json(
      {
        message: 'Resource renamed successfully',
        fromPath,
        toPath,
      },
      { status: 200 }
    );
  } catch (err) {
    const mapped = mapSFTPError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
