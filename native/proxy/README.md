<div align="center">

**English** · [Русский](README.ru.md) · [繁體中文](README.zh-Hant.md) · [Tiếng Việt](README.vi.md)

# Detect.Expert Proxy Companion

The optional Windows helper for the extension's Proxy tab.

</div>

Browsers can't do some proxy jobs on their own: SOCKS5 with a password, HTTP/HTTPS proxies with a login, VLESS, OpenVPN. That's what this helper is for. It's a small program the extension talks to through the browser's native messaging. It starts only when the extension asks, runs as you, and doesn't touch the rest of your system.

You don't need it for plain SOCKS5, HTTP or HTTPS profiles without a login. The extension handles those through the browser's own proxy API.

## Requirements

- Windows 10 or 11, x64.
- Detect.Expert 2.0.0 in Chrome 153+ or Firefox 128+.
- Windows PowerShell (it ships with Windows). No administrator rights.

Other systems: direct SOCKS5 without a password works through the browser everywhere. Native VLESS and OpenVPN there would need a companion built and registered for that platform, with its own key storage. This package is Windows only.

## What's in the package

| Path | What it is |
|---|---|
| `detect-expert-proxy.exe` | The host the browser talks to (Go). Runs the local relay and starts the engines. |
| `engines/xray.exe` | Xray-core v26.3.27 for VLESS (MPL-2.0). |
| `engines/openvpn2socks.exe` | OpenVPN in userspace, built from go-openvpn with my patches (AGPL-3.0-or-later). No TUN driver, no system routes. |
| `engines/source/` | Sources of the engines, patches, license texts and build instructions. |
| `source/companion/` | Sources of the host itself. |
| `Install.ps1`, `Uninstall.ps1` | Per-user install and removal. |
| `companion.json` | The list of every file in the package with its SHA-256. `Install.ps1` checks it. |
| `LICENSE` | The MIT license of the project. The engines have their own, see [Licenses](#licenses). |

## Is it really from me?

The three executables are signed (Authenticode) by **Vektor T13 Technologies B.V.** (Rotterdam, NL). Check before you install:

```powershell
Get-FileHash .\Detect.Expert-Proxy-Companion-windows-x64.zip -Algorithm SHA256   # compare with the release notes
Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
  Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
```

`Status` should say `Valid` and the signer's subject should start with `CN=Vektor T13 Technologies B.V.`. If it doesn't, don't run anything and tell me.

`Install.ps1` also compares every file with `companion.json` before it copies anything. That catches a damaged download. It does not prove who made the package, because `companion.json` travels inside it. The signature does.

## Install

1. Download `Detect.Expert-Proxy-Companion-windows-x64.zip` from [Releases](https://github.com/vektort13/Detect.Expert/releases).
2. Right-click, **Extract All**, and put it somewhere ordinary like Downloads. Not into the folder the installer is going to use under `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion`; the script stops with "Extract the package outside the installation directory first".
3. Find your extension ID. The next section shows how.
4. Open PowerShell in the extracted folder (type `powershell` in Explorer's address bar) and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
```

That ID is for the Chrome Web Store version (the listing is still under review). If you loaded the extension unpacked, use your own ID instead.

You should see `Installed Detect Expert Proxy Companion: <folder>` and `Browser proxy settings, system routes and services were not changed.` Then open the extension's **Proxy** tab, **Companion**, and click **Check companion**. When you save your first protected profile, the extension asks for the optional `nativeMessaging` permission. Say yes, that's how it reaches the helper.

**Firefox only:**

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -FirefoxExtensionId 'detect.expert@detect.expert'
```

Without `-ChromeExtensionId` only Firefox is registered. With it, Chrome, Chromium, Microsoft Edge and Firefox are all registered in one go.

### Which extension ID

- **Chrome Web Store version:** `obbkkjmpgaajcggbhajpdeeadkkchbeo`.
- **Unpacked or local build:** the ID is different, because Chrome derives it from the folder you loaded. You can see it on the extension's Proxy tab (Companion, "Setup steps") and on `chrome://extensions` with Developer mode on, under the extension's name. It's 32 letters from `a` to `p`.

Gotchas: the ID must match exactly, because the host only answers the extension it was registered for. Profiles are kept per extension ID, so the unpacked build and the Store build each have their own saved profiles. Installing again with a different ID creates a second folder, and the registration points at the newest one.

## Why `-ExecutionPolicy Bypass`

`Install.ps1` and `Uninstall.ps1` are plain text scripts and they are **not** Authenticode-signed. On a normal Windows 10/11 PC, PowerShell's default policy refuses to run scripts at all, and files from the internet carry a "downloaded" mark on top of that. So the command above starts PowerShell with `-ExecutionPolicy Bypass`, which applies to that single process only. It doesn't change your machine or user policy.

The scripts are short. Read `Install.ps1` before you run it, that's what it's there for. If you'd rather not use Bypass, you can read the script, then unblock the extracted files (`Get-ChildItem -Recurse | Unblock-File`) and run it under a policy you're comfortable with.

## What the installer does

- Checks every file against `companion.json`.
- Copies the package to `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion\<version>-<package>-<ids>\`.
- Writes `allowed-callers.json` there: the extension IDs that may talk to the host. The host quits right away for anyone else.
- Writes the native messaging manifests next to the files and registers them under `HKCU\Software\...\NativeMessagingHosts\com.detect_expert.proxy`. With a Chrome ID that's the Google\Chrome, Chromium and Microsoft\Edge keys; for Firefox it's Mozilla.

It doesn't ask for administrator rights, install a service, set up autostart, add a driver, change system routes or change the browser's proxy settings. The extension changes the browser's proxy settings, and only when you press Connect (or when you've switched on "Connect when the browser starts").

## How it works

The browser starts `detect-expert-proxy.exe` over native messaging. For a protected profile the host opens a local SOCKS5 relay on `127.0.0.1` with a random port, and the browser is pointed at it. From there:

- **SOCKS5 with a password** and **HTTP/HTTPS with a login:** the relay does the login to your server. HTTP and HTTPS proxies get a `CONNECT` with Basic auth. Only Basic works, and for plain `http` the login travels unencrypted, so use `https` or SOCKS5 when you can. Many HTTP proxies allow `CONNECT` only to port 443; if port 80 is refused you'll see `proxy-denied`.
- **VLESS:** a pinned Xray runs the tunnel. The profile is turned into a Xray config from an allowlist of fields. Arbitrary Xray JSON and insecure TLS aren't accepted.
- **OpenVPN:** a userspace client with its own network stack. DNS goes through the tunnel only.

Engines are started as child processes inside a Windows Job Object, so they die with the host, even after a crash. The config goes to the engine through stdin, credentials through a private environment, and no plaintext config file is written. Engines are never downloaded or updated while it runs.

The kill switch stays on: if the helper or the tunnel fails, proxy-routed requests are blocked, not sent directly.

Saved profiles live in one file per extension ID under `%APPDATA%\Detect.Expert\Proxy\`, encrypted with Windows DPAPI for your Windows user. The extension's own storage keeps only names, addresses, ports and routing, never logins or passwords.

The helper doesn't phone home. It connects only to the servers of your profiles, when you connect or run a check.

## Update

Download the new package and run `Install.ps1` again with the same ID. Your profiles stay where they are. A new package goes into a new folder and the registration moves to it; the old folder can be deleted.

## Uninstall

First turn **Proxy** off in the extension. Then run the uninstaller from the installed copy:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<your folder>\Uninstall.ps1"
```

Replace `<your folder>` with the name of the folder the installer printed. (List them with `Get-ChildItem "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"`.)

Heads-up about what it removes: **only the registry entries** of that installation. The program files and your encrypted profiles stay. That's deliberate, so a reinstall doesn't wipe your servers. If you want everything gone, delete it by hand:

```powershell
# the program files (all installed versions)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"

# the encrypted profiles: logins, passwords, VLESS links, OpenVPN configs. This cannot be undone.
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"
```

If you turn the helper off while Proxy is still on in the extension, traffic through those profiles gets blocked until you turn Proxy off. That's the kill switch doing its job.

## Limits

- Windows x64 only, and only for the browser's own traffic. It's not a system-wide VPN.
- My automated tests run against loopback servers. I haven't tried every commercial OpenVPN or VLESS provider. If your profile doesn't connect, open an issue and tell me which kind it is, without credentials.
- Check connection is manual and one-shot: it sends one request through the chosen proxy to an address you can change.

## Licenses

The project, including the host, is MIT, see `LICENSE` in the package. The engines are separate programs:

- **Xray-core** is MPL-2.0.
- **go-openvpn** (patched, as `openvpn2socks.exe`) is AGPL-3.0-or-later.

Their full sources, my patches and the license texts are in `engines/source/`, with `BUILD-SOURCE.md` to rebuild them. `engines/pins.json` lists the exact versions and checksums.

## Build it yourself

You need Windows x64, Node.js 24 or 25, and the repository.

```powershell
node scripts/build-proxy-engines.mjs     # downloads the pinned Go, Xray and go-openvpn sources, checks SHA-256, builds the engines
node scripts/build-proxy-companion.mjs   # vet + tests, builds detect-expert-proxy.exe, writes companion.json, packs the ZIP
```

Output: `release/proxy-native/windows-amd64/` and `release/Detect.Expert-Proxy-Companion-windows-x64.zip`. Downloads happen only when you run the engines script. A local build isn't signed; the release binaries are signed separately.
