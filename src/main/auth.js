// Google OAuth 2.0 Authorization Code + PKCE flow with a loopback redirect,
// per plan. The refresh token is the only long-lived secret and it is
// encrypted at rest via Electron's safeStorage (DPAPI on Windows).
"use strict";

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { shell, safeStorage } = require("electron");
const { credentialsPath } = require("./config");

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

// In-memory only — never written to disk. Cleared on sign-out or app restart.
let accessToken = null;
let accessTokenExpiresAt = 0;

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function isSignedIn() {
  return fs.existsSync(credentialsPath());
}

function storeRefreshToken(refreshToken) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("System encryption (safeStorage) isn't available on this machine.");
  }
  const encrypted = safeStorage.encryptString(refreshToken);
  fs.mkdirSync(path.dirname(credentialsPath()), { recursive: true });
  fs.writeFileSync(credentialsPath(), encrypted);
}

function loadRefreshToken() {
  const encrypted = fs.readFileSync(credentialsPath());
  return safeStorage.decryptString(encrypted);
}

function signOut() {
  accessToken = null;
  accessTokenExpiresAt = 0;
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    /* already gone */
  }
}

/** Runs one full interactive sign-in: browser consent -> loopback -> token exchange. */
function startSignIn(clientId, clientSecret, accountEmail) {
  return new Promise((resolve, reject) => {
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(16));

    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<html><body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <p>${error ? "Couldn't connect. You can close this tab." : "All set — you can close this tab."}</p>
        </body></html>`
      );

      finish(async () => {
        if (error) throw new Error(`Google returned an error: ${error}`);
        if (returnedState !== state) throw new Error("State mismatch — possible interception attempt.");
        if (!code) throw new Error("No authorization code was received.");

        const tokens = await exchangeCode(clientId, clientSecret, code, codeVerifier);
        if (!tokens.refresh_token) {
          throw new Error(
            "Google didn't return a refresh token. Revoke the app's previous access at myaccount.google.com/permissions and try again."
          );
        }
        storeRefreshToken(tokens.refresh_token);
        accessToken = tokens.access_token;
        accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
      });
    });

    function finish(work) {
      if (settled) return;
      settled = true;
      work()
        .then(() => {
          server.close();
          resolve();
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    }

    server.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${REDIRECT_PORT} is already in use. Close whatever's using it and try again.`)
          : err
      );
    });

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);
      if (accountEmail) {
        authUrl.searchParams.set("login_hint", accountEmail);
        const domain = accountEmail.split("@")[1];
        if (domain) authUrl.searchParams.set("hd", domain);
      }
      shell.openExternal(authUrl.toString());
    });

    // Don't hang forever if the user never completes the browser flow.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("Timed out waiting for authorization in the browser."));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCode(clientId, clientSecret, code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });
  return tokenRequest(body);
}

async function refreshAccessToken(clientId, clientSecret) {
  const refreshToken = loadRefreshToken();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const tokens = await tokenRequest(body);
  accessToken = tokens.access_token;
  accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
  return accessToken;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  return data;
}

/** Returns a valid access token, refreshing if it's missing or about to expire. */
async function getAccessToken(clientId, clientSecret) {
  if (!isSignedIn()) throw new Error("Not signed in.");
  const twoMinutes = 2 * 60 * 1000;
  if (accessToken && Date.now() < accessTokenExpiresAt - twoMinutes) {
    return accessToken;
  }
  return refreshAccessToken(clientId, clientSecret);
}

/** Forces the next getAccessToken() call to refresh instead of reusing memory. */
function invalidateAccessToken() {
  accessToken = null;
  accessTokenExpiresAt = 0;
}

module.exports = {
  REDIRECT_PORT,
  isSignedIn,
  startSignIn,
  getAccessToken,
  invalidateAccessToken,
  signOut,
};
