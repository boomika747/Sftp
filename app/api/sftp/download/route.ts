import { basename } from 'node:path';
import { NextRequest } from 'next/server';
import { getSFTPClient, mapSFTPError, sanitizePath } from '@/lib/sftp';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  let sftpReadStream: (NodeJS.ReadableStream & { destroy: () => void }) | null = null;

  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing required query parameter: path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const safePath = sanitizePath(path);
    const sftp = await getSFTPClient();

    const stat = await new Promise<{ size: number }>((resolve, reject) => {
      sftp.stat(safePath, (err, attrs) => {
        if (err) return reject(err);
        resolve({ size: attrs.size ?? 0 });
      });
    });

    sftpReadStream = sftp.createReadStream(safePath);
    console.log(`[download] stream created for ${safePath}`);

    req.signal.addEventListener('abort', () => {
      if (sftpReadStream) {
        sftpReadStream.destroy();
        console.log(`[download] stream destroyed on client abort for ${safePath}`);
      }
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sftpReadStream?.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        sftpReadStream?.on('end', () => {
          controller.close();
          console.log(`[download] stream ended for ${safePath}`);
        });

        sftpReadStream?.on('close', () => {
          console.log(`[download] stream closed for ${safePath}`);
        });

        sftpReadStream?.on('error', (err) => {
          controller.error(err);
          console.log(`[download] stream errored for ${safePath}: ${String(err)}`);
        });
      },
      cancel() {
        if (sftpReadStream) {
          sftpReadStream.destroy();
          console.log(`[download] stream destroyed on cancel for ${safePath}`);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${basename(safePath)}"`,
        'Content-Length': String(stat.size),
      },
    });
  } catch (err) {
    const mapped = mapSFTPError(err);
    return new Response(JSON.stringify({ error: mapped.message }), {
      status: mapped.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
