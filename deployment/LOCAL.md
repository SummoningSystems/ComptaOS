# Shared financial ecosystem server

## Install

Use a Docker host with Compose, local disk storage, and a Git checkout of the tested release.
Run from the repository root:

```sh
cp deployment/local.env.example deployment/local.env
docker compose --env-file deployment/local.env -f deployment/compose.local.yml up -d --build
```

For access from both computers, set COMPTAOS_ADDRESS and COMPTAOS_BIND_IP in
deployment/local.env to the server's fixed LAN IP before starting. The default is
HTTPS on localhost. The backend has no published port.

Caddy issues a local certificate. Copy its public root certificate:

```sh
docker compose --env-file deployment/local.env -f deployment/compose.local.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./comptaos-local-root.crt
```

Import this certificate into the trusted root certificate store on each device/browser.
Keep Caddy's private keys in its volume. Open https://localhost or https://YOUR_LAN_IP,
create the first user, then **Créer l’écosystème**. Add people, companies and accounts
from **Structure**. In **Application**, create a member invitation and share the link
with your partner. See the [step-by-step ecosystem guide](../docs/ecosystem.md).
Both users see all accounts and transactions. Person names describe financial
ownership and do not create login accounts. The package uses one application instance;
do not scale it or share the writable data volume between servers.

## First statement

1. Add the desired accounts in **Structure** (no fixed count).
2. Optionally enter the balance at the beginning of your first imported day.
3. Import CSV, OFX or QIF into its destination account. Preview before confirming.
4. Review possible duplicates; identical purchases on different accounts are retained.
5. Adjust expense allocations and match internal transfers.
6. Open the professional allocation’s accounting treatment in its company tab.

Allocations track financial purpose; company accounting is explicitly reviewed.
Recurring forecasts never generate bank movements. The ecosystem uses EUR.
Powens synchronization is manual and requires your own configured provider credentials.
Shared receipts stay local. Optional OCR uses only `OCR_LOCAL_URL`.

## Backups and restore

Backups run daily and retain 14 days in a separate volume. **Application** shows the
last success/error and offers an immediate backup. The archive includes receipts,
authentication, metadata, and transaction history. Git alone excludes receipts and
is not a complete backup.

Copy backup files to storage outside this host regularly:

```sh
docker compose --env-file deployment/local.env -f deployment/compose.local.yml cp app:/backups ./backup-copy
```

For restore, stop the application and retain the current data before preparing an
empty destination. The offline command refuses nonempty destinations, validates paths,
checks every file hash, and rejects incomplete archives:

```sh
node backend/dist/restore.js /path/to/backup.jsonl.gz /path/to/empty-workspace
```

A container can restore into a fresh data volume with its app stopped. Override the
entrypoint so the normal startup does not populate the workspace first:

```sh
docker compose --env-file deployment/local.env -f deployment/compose.local.yml run --rm --no-deps --entrypoint node app dist/restore.js /backups/ARCHIVE.jsonl.gz /data/workspace
```

Restart the application after restoration. Preserve the Caddy data volume separately
to retain the trusted local CA; if lost, install the replacement root certificate.
Archives contain private financial and login data; restrict access to copied archives.

## Updates

Use Git to obtain the tested release, create a backup, rebuild, and restart with
Compose. Keep the previous Git commit and its matching backup for rollback.
Ecosystem files use schemaVersion 1. Existing household/company data is retained and is not automatically migrated. Start a fresh ecosystem after taking a backup.
Do not deploy this package through the existing public-server scripts.

Check status and logs:

```sh
docker compose --env-file deployment/local.env -f deployment/compose.local.yml ps
docker compose --env-file deployment/local.env -f deployment/compose.local.yml logs --tail=100 app
```
