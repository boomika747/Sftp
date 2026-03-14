import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';

export interface SFTPFileEntry {
  name: string;
  type: 'd' | '-' | 'l';
  size: number;
  modifyTime: number;
  rights: {
    user: string;
    group: string;
    other: string;
  };
}

interface SFTPConnection {
  client: Client;
  sftp: SFTPWrapper;
  lastUsed: number;
}

const MAX_IDLE_MS = 30000;
let connectionPool: SFTPConnection | null = null;
let connectionPromise: Promise<SFTPConnection> | null = null;

function modeToRwx(octal: number): string {
  const r = (octal & 4) ? 'r' : '-';
  const w = (octal & 2) ? 'w' : '-';
  const x = (octal & 1) ? 'x' : '-';
  return r + w + x;
}

function getSFTPConfig(): ConnectConfig {
  return {
    host: process.env.SFTP_HOST || 'localhost',
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USER || 'testuser',
    password: process.env.SFTP_PASSWORD || 'testpass',
    readyTimeout: 10000,
    keepaliveInterval: 10000,
  };
}

function isConnectionAlive(conn: SFTPConnection): boolean {
  const idleTime = Date.now() - conn.lastUsed;
  return idleTime < MAX_IDLE_MS;
}

function createNewConnection(): Promise<SFTPConnection> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const config = getSFTPConfig();

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Connection timeout'));
    }, 15000);

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          reject(err);
          return;
        }
        clearTimeout(timeout);
        const conn: SFTPConnection = { client, sftp, lastUsed: Date.now() };
        resolve(conn);
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      connectionPool = null;
      connectionPromise = null;
      reject(err);
    });

    client.on('close', () => {
      connectionPool = null;
      connectionPromise = null;
    });

    client.on('end', () => {
      connectionPool = null;
      connectionPromise = null;
    });

    client.connect(config);
  });
}

export async function getSFTPConnection(): Promise<SFTPConnection> {
  if (connectionPool && isConnectionAlive(connectionPool)) {
    connectionPool.lastUsed = Date.now();
    return connectionPool;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPool = null;
  connectionPromise = createNewConnection()
    .then((conn) => {
      connectionPool = conn;
      connectionPromise = null;
      return conn;
    })
    .catch((err) => {
      connectionPool = null;
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

export async function listDirectory(path: string): Promise<SFTPFileEntry[]> {
  const conn = await getSFTPConnection();
  conn.lastUsed = Date.now();

  return new Promise((resolve, reject) => {
    conn.sftp.readdir(path, (err, list) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'ERR_GENERIC_CLIENT') {
          return reject(Object.assign(new Error('No such file or directory'), { code: 'ENOENT' }));
        }
        return reject(err);
      }

      const entries: SFTPFileEntry[] = list.map((item) => {
        const mode = item.attrs.mode || 0;
        const typeChar = ((mode & 0o170000) === 0o040000) ? 'd' :
          ((mode & 0o170000) === 0o120000) ? 'l' : '-';

        return {
          name: item.filename,
          type: typeChar as 'd' | '-' | 'l',
          size: item.attrs.size || 0,
          modifyTime: (item.attrs.mtime || 0) * 1000,
          rights: {
            user: modeToRwx((mode >> 6) & 7),
            group: modeToRwx((mode >> 3) & 7),
            other: modeToRwx(mode & 7),
          },
        };
      });

      resolve(entries);
    });
  });
}

export function getSFTPClient(): Promise<SFTPWrapper> {
  return getSFTPConnection().then((conn) => {
    conn.lastUsed = Date.now();
    return conn.sftp;
  });
}

export function sanitizePath(inputPath: string): string {
  // Normalize and check for path traversal
  const normalized = inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  const parts = normalized.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      // Reject path traversal attempts
      throw Object.assign(new Error('Path traversal detected'), { code: 'EACCES' });
    } else if (part !== '.') {
      resolved.push(part);
    }
  }

  const safe = resolved.join('/');
  if (!safe.startsWith('/')) {
    return '/' + safe;
  }
  return safe;
}

export function mapSFTPError(err: unknown): { status: number; message: string } {
  const e = err as NodeJS.ErrnoException & { code?: string; description?: string };
  const code = e.code || '';
  const message = e.message || 'Unknown error';

  if (code === 'ENOENT' || message.includes('No such file') || message.includes('does not exist')) {
    return { status: 404, message: 'File or directory not found' };
  }
  if (code === 'EACCES' || code === 'EPERM' || message.includes('Permission denied') || message.includes('traversal')) {
    return { status: 403, message: 'Permission denied' };
  }
  if (code === 'EEXIST' || message.includes('already exists')) {
    return { status: 409, message: 'Resource already exists' };
  }
  if (code === 'ENOTDIR') {
    return { status: 400, message: 'Not a directory' };
  }
  if (message.includes('timeout') || message.includes('Timed out')) {
    return { status: 504, message: 'SFTP server connection timeout' };
  }

  return { status: 500, message: 'Internal server error' };
}

// Cleanup idle connections
if (typeof process !== 'undefined') {
  const cleanup = () => {
    if (connectionPool) {
      try {
        connectionPool.client.end();
      } catch {
        // ignore
      }
      connectionPool = null;
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
