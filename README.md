# Minecraft Bot Dashboard

A Node.js web dashboard and Mineflayer bot. The app starts in neutral mode unless a Minecraft host is configured.

## Run locally

1. Install Node.js 22.
2. Run `npm ci` in this folder.
3. Run `npm start`.
4. Open `http://localhost:3000`.
5. Enter the Minecraft host, port, and version in the dashboard, then apply the settings.

To set a persistent local target instead, copy `.env.example` to `.env` and set `MC_HOST`. Do not commit `.env`.

## Deploy from GitHub

Use a hosting service that supports a persistent Node.js web service and outbound TCP connections to the Minecraft server.

- Repository/root directory: this folder
- Runtime: Node.js 22
- Install/build command: `npm ci`
- Start command: `npm start`
- Health/check URL: `/api/config`

The app listens on the hosting platform's `PORT` and binds to `0.0.0.0`. Add these environment variables in the hosting dashboard when needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MC_HOST` | blank | Minecraft host; blank keeps bots from joining |
| `MC_PORT` | `25575` | Minecraft server port |
| `MC_VERSION` | `1.21.11` | Mineflayer protocol version |
| `OWNER` | `MEW_SAN` | Owner username for bot commands/follow |
| `BOT_COUNT` | `1` | Number of bots to start |
| `BOT_PREFIX` | `mew_bot` | Generated bot username prefix; the first slot defaults to `mew_bot2` |

Server settings entered in the dashboard apply immediately but are held in memory. Set `MC_HOST`, `MC_PORT`, and `MC_VERSION` in the hosting environment if they should survive service restarts. The host must allow persistent processes and outbound Minecraft connections; static-site hosting is not sufficient.

## GitHub upload

Create a repository from this project folder and push the source files. `.gitignore` excludes `node_modules`, `.env`, and `registered.json`; dependencies are restored from `package-lock.json` with `npm ci`.

Do not commit account tokens, passwords, `.env` files, or `registered.json`.