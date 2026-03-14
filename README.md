# Production-Ready Web-Based SFTP Client (Next.js)

Secure browser-based SFTP file manager built with Next.js, Node.js streams, and Docker Compose.

## Features

- Secure server-side SFTP operations using `ssh2`
- Streaming download endpoint (`/api/sftp/download`) with client abort handling
- Streaming multipart upload endpoint (`/api/sftp/upload`) using `busboy`
- Upload limit enforcement at 100MB (returns HTTP 413)
- Directory listing, rename/move, and delete endpoints
- Frontend file manager with:
  - Directory tree (`data-test-id="directory-tree"`)
  - File list view (`data-test-id="file-list-view"`)
  - Breadcrumbs (`data-test-id="breadcrumbs"`)
  - Upload progress bar (`data-test-id="upload-progress-bar"`)
  - Preview panel (`data-test-id="preview-panel"`) for text/image/unsupported types
- Dockerized app + test SFTP server (`atmoz/sftp`)

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Node.js streams
- ssh2
- busboy
- Docker Compose

## Project Structure

- `docker-compose.yml` - Runs app + SFTP services
- `Dockerfile` - Builds Next.js application container
- `.env.example` - Required environment variables
- `submission.json` - Test credentials/schema for evaluation
- `lib/sftp.ts` - SFTP connection and helper logic
- `app/api/sftp/*` - SFTP API route handlers
- `app/components/file-manager.tsx` - Main UI and operations

## Environment Variables

Copy `.env.example` to `.env.local` for local development.

Required variables:

- `SFTP_HOST`
- `SFTP_PORT`
- `SFTP_USER`
- `SFTP_PASSWORD`
- `NEXT_PUBLIC_API_BASE_URL`

## Run with Docker Compose

```bash
docker-compose up --build -d
```

Services:

- App: `http://localhost:3000`
- SFTP server: `localhost:2222` (mapped to container port 22)

SFTP test credentials:

- Host: `sftp` (inside docker network) / `localhost` (from host)
- Port: `22` (inside docker network) / `2222` (from host)
- Username: `testuser`
- Password: `testpass`
- Base directory: `/upload`

## API Endpoints

### 1) List directory

- `GET /api/sftp/list?path=/upload`
- Response: array of entries with `name`, `type`, `size`, `modifyTime`, `rights`

### 2) Download file (streaming)

- `GET /api/sftp/download?path=/upload/file.txt`
- Headers:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="file.txt"`
  - `Content-Length: <bytes>`
- Supports clean cancellation via `AbortController` and stream destruction

### 3) Upload file (multipart streaming)

- `POST /api/sftp/upload`
- Form fields:
  - `path` (destination directory, e.g. `/upload`)
  - `file` (file blob)
- Success: `201` with `{ message, filePath }`
- File size limit: 100MB, otherwise `413 Payload Too Large`

### 4) Delete file or empty directory

- `DELETE /api/sftp/delete?path=/upload/file.txt`

### 5) Rename/move resource

- `PATCH /api/sftp/rename`
- Body: `{ "fromPath": "/upload/a.txt", "toPath": "/upload/b.txt" }`

## Security Notes

- All SFTP credentials are server-side only
- Path sanitization rejects path traversal attempts (e.g. `../`)
- Errors are mapped to safe HTTP responses without sensitive leakage

## Local Development (without Docker)

1. Install dependencies:

```bash
npm install
```

2. Run dev server:

```bash
npm run dev
```

3. Ensure an SFTP server is available and `.env.local` is configured.

## Verification Checklist Mapping

- Containerization via `docker-compose.yml` and `Dockerfile`: implemented
- `.env.example`: implemented
- `submission.json`: implemented with required schema/values
- `GET /api/sftp/list`: implemented
- `GET /api/sftp/download`: implemented (streaming + headers + abort cleanup)
- `POST /api/sftp/upload`: implemented (multipart streaming + 100MB limit)
- `DELETE /api/sftp/delete`: implemented
- `PATCH /api/sftp/rename`: implemented
- UI `data-test-id` requirements: implemented
- Upload progress UI: implemented
- Preview panel requirements: implemented

## Notes

- For strict production hardening, add authentication/authorization before exposing these routes publicly.
- Integration tests can be added in `/tests` for CI automation.
# Sftp
