# CalendarWidget

Always-on-top Windows desktop widget that shows your next Google Calendar
meeting and how long until it starts. Expands to show today's and tomorrow's
agenda. Dark "glass" design.

## 1. Create the OAuth Client in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (use your own project, or one in the BairesDev org you have access to).
2. Enable the **Google Calendar API** (APIs & Services → Library).
3. In **APIs & Services → OAuth consent screen**:
   - If the project lives inside the `bairesdev.com` org, choose **Internal**
     (skips Google's verification process).
   - If it's a personal project, choose **External** and add yourself as a
     *test user*.
4. In **Credentials → Create Credentials → OAuth client ID**:
   - Type: **Desktop app** (recommended, no redirect URI setup needed).
   - If the client already exists as type **Web**, add this authorized
     redirect URI instead:
     ```
     http://127.0.0.1:53682/callback
     ```
5. Copy the **Client ID** and **Client Secret**.

## 2. Install and run

```bash
npm install
npm start
```

On first launch the widget shows a setup screen: paste the Client ID and
Client Secret there and click **Connect with Google**. Your browser opens for
consent; once you accept, the widget starts showing your agenda.

The **Google account** field is optional — it just pre-fills the account
picker on Google's consent screen (and restricts it to that Workspace domain
if the address has one). Leave it blank to pick from all your signed-in
Google accounts instead. Either way, the widget always ends up showing the
primary calendar of whichever account you actually authorize.

The OAuth client credentials are saved to:
`%APPDATA%/CalendarWidget/config.json`

The refresh token is saved **encrypted** (via `safeStorage` / Windows DPAPI) to:
`%APPDATA%/CalendarWidget/credentials.bin`

Neither file is committed to the repo (see `.gitignore`).

## 3. Usage

- **Drag**: click and drag anywhere on the empty part of the header.
- **Expand/collapse**: the `⌄` / `︿` button, or the global shortcut
  `Ctrl+Alt+Space`.
- **Join a meeting**: the "Join" button (only shows when a Zoom / Meet /
  Teams / Webex link was detected on the event).
- **System tray**: since the window doesn't show in the taskbar
  (`skipTaskbar`), the tray icon is how you get it back if it's hidden —
  left-click shows/hides it, right-click opens the menu (refresh, expand,
  always-on-top, start with Windows, sign out, etc.).

## 4. Building an installer

```bash
npm run build
```

Produces an NSIS installer and a portable build in `dist/`.

## Design notes

- The "glass" effect uses **native Windows 11 acrylic material** by default
  (`config.glass = "acrylic"`). If the corners don't look right or you'd
  rather have a fully CSS-controlled look, change that value to `"css"` in
  `%APPDATA%/CalendarWidget/config.json` (with the app closed) and restart.
- The countdown only ever shows hours and minutes, never seconds, and
  recomputes locally every 15s — it doesn't depend on the network.
- The agenda refreshes every 60s. If the connection fails, the last known
  agenda is shown marked as "outdated" instead of a blank screen.
- Automatically filtered out: cancelled events, events you declined, and
  all-day events.
