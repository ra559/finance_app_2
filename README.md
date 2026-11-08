# Ledger

Ledger is a private, self-hosted personal finance app. It provides account balances, transaction imports, spending categories, budgets, net-worth snapshots, recurring payment detection, investment holdings, an optional AI chat, and a read-only MCP endpoint.

The app is intentionally single-user. SQLite, session signing material, and encrypted Plaid credentials live in the persistent `data` directory. Plaid and AI are optional integrations; importing a file and managing accounts manually work without either one.

## What is included

- First-run setup creates one local user. Passwords use bcrypt; browser sessions are HTTP-only, same-site cookies.
- Manual accounts and balance updates, plus daily net-worth, portfolio, and individual holding snapshots.
- CSV, OFX, and QFX imports. Duplicate rows are skipped; common bank description and amount columns are recognized.
- Transaction categorization, category budgets, cash-flow charts, and recurring transaction estimates.
- Optional Plaid Link connection and transaction sync. Plaid access tokens are encrypted at rest with an instance key. The server asks Plaid for updates at startup and every six hours; institution refresh timing depends on Plaid and the bank.
- Optional local Ollama chat or an OpenAI-compatible chat endpoint. Chat is not saved in Ledger. The configured AI service receives your message and finance context, including balances, budgets, category totals, current investment holdings, portfolio history, and up to 40 recent transaction details.
- A Streamable HTTP MCP endpoint at `/mcp` with bearer-token authentication and read-only query tools.

## Quick start with Docker Compose

You need Docker Engine with the Compose plugin, or a recent Podman installation with `podman compose`.

```sh
cp .env.example .env
chmod 600 .env
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). On first boot, Ledger prints a one-time setup code in its server logs. Read it with `docker compose logs ledger` (`podman compose logs ledger` on Podman), then use that code to create a username and a password of at least 12 characters. The code is removed after setup, and the setup endpoint is disabled once the account is created.

For Podman, use the same file and commands through `podman compose`:

```sh
cp .env.example .env
chmod 600 .env
podman compose up -d --build
```

The web port is bound to `127.0.0.1` on the host. Keep that binding when using a local reverse proxy or Cloudflare Tunnel. To make the app available on your LAN, change the port mapping to `3000:3000`, put an HTTPS reverse proxy in front of it, and apply firewall rules appropriate to your network. Production cookies are marked Secure.

### Start optional local AI with Ollama

Edit `.env` and set a model, for example:

```dotenv
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:7b
```

Start the optional Ollama container and download the model once:

```sh
docker compose --profile ai up -d --build
docker compose exec ollama ollama pull qwen2.5:7b
```

Use the matching `podman compose` commands on Podman. Ollama needs substantial RAM and disk space; choose a model that fits your server. If the Ollama container is not desired, point `OLLAMA_URL` at an Ollama service you already run and set `OLLAMA_MODEL`.

### Connect a bank through Plaid

Create Plaid credentials in the [Plaid Dashboard](https://dashboard.plaid.com/), then add them to `.env`:

```dotenv
PLAID_CLIENT_ID=your-client-id
PLAID_SECRET=your-sandbox-secret
PLAID_ENV=sandbox
```

Restart Ledger with `docker compose up -d` (or `podman compose up -d`). The Accounts page will show **Connect bank**. Use Plaid sandbox institutions and test credentials until you are ready to configure production access and have the required Plaid product approval. Transactions are requested as a core product; investment holdings are requested as an optional product and depend on institution support and Plaid plan pricing. Bank data availability and refresh timing vary by institution. The Plaid Link JavaScript is loaded only when you choose to connect a bank.

## Local development

Requires Node.js 22 or later and build tools for `better-sqlite3` if a prebuilt package is unavailable.

```sh
npm install
npm run dev
```

Vite serves the frontend on port `5173` and proxies API calls to the Ledger server on port `3000`. For a production-style local run:

```sh
npm run build
npm start
```

For local development, copy the one-time setup code printed in the server terminal and enter it in the first-run form. The first run creates `./data/instance.key` and `./data/ledger.db` with private directory and file permissions. Back up the whole `data` directory together; the key is required to decrypt linked bank credentials and validate sessions. Keep it private and do not commit it.

## Deploy on a Debian server

The container deployment is the simplest Debian setup and works on Debian 12/13 hosts. Install Docker Engine and the Compose plugin from Docker's official Debian repository, then:

```sh
git clone <your-private-repository> ledger
cd ledger/project_code
cp .env.example .env
docker compose up -d --build
```

If the project files are already on the server, skip the clone. Keep `.env` readable only by the server administrator (`chmod 600 .env`). The named `ledger-data` volume holds the database and instance key. Update with `git pull` and `docker compose up -d --build`; the database volume is retained.

### Run directly on Debian without containers

Install Node.js 22, compiler tools, and SQLite build prerequisites. Then copy the project folder to the server and run:

```sh
sudo apt update
sudo apt install -y ca-certificates curl git python3 make g++
```

Install a current Node.js 22 release using NodeSource or your preferred trusted package source. Then:

```sh
cd /opt/ledger/project_code
npm install
npm run build
```

Create a system user and data directory, set ownership, and create a systemd unit such as `/etc/systemd/system/ledger.service`:

```sh
sudo useradd --system --home-dir /var/lib/ledger --create-home --shell /usr/sbin/nologin ledger
sudo install -d -o ledger -g ledger -m 700 /var/lib/ledger
sudo install -d -o root -g root -m 755 /etc/ledger
sudoedit /etc/ledger/ledger.env
sudo chmod 600 /etc/ledger/ledger.env
```

```ini
[Unit]
Description=Ledger personal finance app
After=network.target

[Service]
Type=simple
User=ledger
Group=ledger
WorkingDirectory=/opt/ledger/project_code
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/ledger
Environment=TRUST_PROXY=1
EnvironmentFile=-/etc/ledger/ledger.env
ExecStart=/usr/bin/node /opt/ledger/project_code/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ledger

[Install]
WantedBy=multi-user.target
```

Store optional Plaid or AI settings in `/etc/ledger/ledger.env` with permissions `600`, then enable the service. On first boot, read the one-time setup code from `sudo journalctl -u ledger -n 30` and enter it in the browser:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now ledger
sudo systemctl status ledger
```

Keep the app bound behind a local reverse proxy or Tunnel. The server itself listens on port 3000; configure your firewall so the app is not exposed directly unless you intend that.

## Deploy on a Debian VPS

Choose a supported Debian VPS image, create a non-root administrator, enable SSH key authentication, and update the server before installing Docker or Node. Open only the ports you need: SSH for administration and HTTPS when using a reverse proxy. With Cloudflare Tunnel, the Ledger origin can remain on loopback and needs no inbound web port.

Use the Docker Compose deployment above, keep the project and `.env` private, and enable host security updates. Set a regular backup for the `ledger-data` volume or `/var/lib/ledger`, and store a second encrypted copy off the VPS. Back up the database and `instance.key` together. A restored database without its matching key cannot use saved Plaid tokens.

For local snapshots, stop Ledger briefly before copying its data volume, or use SQLite's online backup mechanism. Do not expose the SQLite database or `instance.key` through a web server.

## Publish through Cloudflare Tunnel and protect it with Access

Cloudflare Tunnel gives the VPS an outbound-only connection to Cloudflare. Cloudflare Access adds an email one-time PIN gate before the Ledger login page.

1. Add your domain to Cloudflare and complete its DNS setup.
2. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** (some dashboard layouts show **Networking → Tunnels**) and create a remotely managed tunnel. Add a **Published application route** with your chosen hostname, such as `finance.example.com`, and the service `http://ledger:3000` when using the Compose tunnel service. Use `http://localhost:3000` if `cloudflared` runs directly on the Debian host. Leave the connector stopped while you finish the Access policy below.
3. In **Zero Trust → Integrations → Identity providers**, add **One-time PIN** if it is not already available.
4. In **Zero Trust → Access controls → Applications**, add a **Self-hosted** application for `finance.example.com`. Add an **Allow** policy whose **Include** rule is the exact email address you use. For a small household, add only the named email addresses you intend to allow. Do not use **Everyone** or an unrestricted “One-time PIN” login-method include rule. Save the app.
5. Copy the tunnel token. Add `TUNNEL_TOKEN=...` to the private `.env` file, then start the connector:

   ```sh
   docker compose --profile cloudflare up -d
   ```

   Podman users can run `podman compose --profile cloudflare up -d`. Do not publish or commit the tunnel token. To run `cloudflared` as a Debian service instead, use the install command shown in the Cloudflare dashboard and configure the same hostname route there.
6. Test it in a private browser window. Cloudflare should email the allowlisted address a single-use PIN before showing Ledger's own login screen.

Cloudflare's email PIN is a one-time Access sign-in method. It protects the route with email verification, while Ledger still asks for its local password. Cloudflare documents separate **Independent MFA** controls when you require a true second factor at the Access layer; those controls support an authenticator app (TOTP), security key, or biometrics. Email PIN itself is not an additional MFA factor. Choose a short Access session lifetime if you want to be challenged more often.

## MCP clients

Open **Settings → Model Context Protocol** and create a read-only token. Copy it when it appears; Ledger stores only its hash. The endpoint is `https://your-host/mcp` (or `http://localhost:3000/mcp` on the local network). Configure your MCP client to use Streamable HTTP and send:

```http
Authorization: Bearer ldg_your-token
```

Available tools are `get_spending_summary`, `get_budget_progress`, `get_net_worth`, `list_transactions`, `list_accounts`, `get_investment_holdings`, and `list_recurring_bills`. Tokens can be revoked from Settings. Use a separate token per client. The MCP tools are read-only.

### Use MCP through Cloudflare Access

Browser clients can complete the Access email login, but command-line and MCP clients cannot follow that browser redirect. Keep the email PIN policy on the main hostname for the Ledger UI. For MCP, create a more-specific self-hosted Access application for `finance.example.com/mcp` and give it a **Service Auth** policy that includes a dedicated Cloudflare Service Token. Create the token under **Zero Trust → Access controls → Service credentials → Service Tokens**. Add all three headers to the MCP client's custom header configuration:

```http
Authorization: Bearer ldg_your-ledger-token
CF-Access-Client-Id: your-cloudflare-client-id
CF-Access-Client-Secret: your-cloudflare-client-secret
```

The Cloudflare token authenticates the MCP client at the edge; the Ledger token still authenticates it to the app. Keep and rotate both credentials separately.

## Data and privacy notes

- No finance data is sent anywhere for local/manual use. Plaid and the configured AI service are external services you explicitly enable.
- For AI chat, the server sends your message and finance context to the endpoint set by `OLLAMA_URL` or `OPENAI_BASE_URL`. A local Ollama endpoint keeps inference on your own machine; a hosted endpoint receives data according to that provider's terms.
- Plaid access tokens are encrypted with AES-256-GCM. The encryption key is generated in `data/instance.key`. Protect and back up the database and key together.
- Ledger currently supports one local user and USD display. Plaid Link is configured for US institutions. CSV parsing expects a header row and common date/description/amount fields. QFX uses OFX transaction records.
- Recurring payments are estimates inferred from transaction history. Net worth history starts when Ledger records its first snapshot; it cannot reconstruct older balances without imported historical account values.
- Keep the app and its public endpoint updated. Cloudflare Access is an additional edge gate, not a replacement for Ledger's password.

## Backup and restore

For Compose, stop the app and archive the named volume using your container engine's volume tooling, or bind-mount a protected host directory instead. A simple bind mount is `./data:/app/data`; ensure UID `10001` can write to it. Ledger sets the data directory to mode `700` and database/key files to mode `600`. Back up `ledger.db`, `instance.key`, and SQLite WAL files as a consistent set. Restore them together and restart the same app instance.

## Integration references

- [Plaid Link for web](https://plaid.com/docs/link/web/) and [Transactions Sync](https://plaid.com/docs/transactions/) describe the bank-link token and incremental transaction flow.
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) describes the HTTP transport used by `/mcp`.
- Cloudflare's [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), and [Service Tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) cover the Access setup in this guide.
