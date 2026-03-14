import { dirname, join } from 'node:path';
import Busboy from 'busboy';
import { NextRequest, NextResponse } from 'next/server';
import { getSFTPClient, mapSFTPError, sanitizePath } from '@/lib/sftp';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

async function ensureRemoteDirectoryExists(sftp: Awaited<ReturnType<typeof getSFTPClient>>, targetPath: string) {
  const parts = targetPath.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current += '/' + part;
    await new Promise<void>((resolve, reject) => {
      sftp.stat(current, (statErr, stat) => {
        if (!statErr && stat) {
          resolve();
          return;
        }
        sftp.mkdir(current, (mkdirErr) => {
          // Ignore already exists race
          if (mkdirErr && !String(mkdirErr.message || '').includes('Failure')) {
            reject(mkdirErr);
            return;
          }
          resolve();
        });
      });
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const sftp = await getSFTPClient();

    const result = await new Promise<{ filePath: string }>((resolve, reject) => {
      const busboy = Busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: { fileSize: MAX_FILE_SIZE },
      });

      let uploadPath = '';
      let uploadedFilePath = '';
      let hasFile = false;
      let rejected = false;

      busboy.on('field', (name, value) => {
        if (name === 'path') {
          try {
            uploadPath = sanitizePath(value);
          } catch (err) {
            rejected = true;
            reject(err);
          }
        }
      });

      busboy.on('file', (name, file, info) => {
        if (name !== 'file') {
          file.resume();
          return;
        }

        hasFile = true;

        if (!uploadPath) {
          rejected = true;
          file.resume();
          reject(Object.assign(new Error('Missing destination path'), { code: 'EINVAL' }));
          return;
        }

        const safeName = info.filename.replace(/[\\/]/g, '_');
        uploadedFilePath = join(uploadPath, safeName).replace(/\\/g, '/');
        const remoteDir = dirname(uploadedFilePath).replace(/\\/g, '/');

        ensureRemoteDirectoryExists(sftp, remoteDir)
          .then(() => {
            const writeStream = sftp.createWriteStream(uploadedFilePath);

            file.on('limit', () => {
              rejected = true;
              file.unpipe(writeStream);
              writeStream.destroy();
              reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
            });

            writeStream.on('error', (err: Error) => {
              rejected = true;
              reject(err);
            });

            writeStream.on('finish', () => {
              if (!rejected) {
                resolve({ filePath: uploadedFilePath });
              }
            });

            file.pipe(writeStream);
          })
          .catch((err) => {
            rejected = true;
            reject(err);
          });
      });

      busboy.on('finish', () => {
        if (rejected) return;
        if (!uploadPath) {
          reject(Object.assign(new Error('Missing required field: path'), { code: 'EINVAL' }));
          return;
        }
        if (!hasFile) {
          reject(Object.assign(new Error('Missing required field: file'), { code: 'EINVAL' }));
          return;
        }
      });

      busboy.on('error', reject);

      const reader = req.body?.getReader();
      if (!reader) {
        reject(new Error('Request body is not readable'));
        return;
      }

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            busboy.end();
            break;
          }
          busboy.write(Buffer.from(value));
        }
      };

      pump().catch(reject);
    });

    return NextResponse.json(
      {
        message: 'File uploaded successfully',
        filePath: result.filePath,
      },
      { status: 201 }
    );
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const mapped = mapSFTPError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
