# Proxy companion: the short guide

[English](proxy-companion.md) · [Русский](proxy-companion.ru.md)

The companion is a small Windows program that lets the Proxy tab do what a browser can't: SOCKS5 with a password, HTTP/HTTPS proxies with a login, VLESS and OpenVPN. This page is the quick path. Every detail (what's in the package, how it works, licenses, building it) is in the [companion README](../../companion/README.md).

## Do I need it?

| Your proxy | Companion needed? |
|---|---|
| SOCKS5, HTTP or HTTPS **without** a login | No. The browser handles it. |
| SOCKS5 with a password | Yes |
| HTTP or HTTPS with a login | Yes |
| VLESS | Yes |
| OpenVPN (.ovpn) | Yes |

It's Windows 10/11 x64 only. It installs for your user, with no admin rights, no services and no autostart.

## Install in five steps

1. Download `Detect.Expert-Proxy-Companion-windows-x64.zip` from [Releases](https://github.com/vektort13/Detect.Expert/releases).
2. Extract it to an ordinary folder, for example Downloads.
3. Get your extension ID (see below).
4. Open PowerShell in that folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
   ```

5. In the extension open **Proxy**, then **Companion**, and press **Check companion**.

That ID belongs to the Chrome Web Store version of the extension (the listing is under review). For Firefox only, run `powershell -ExecutionPolicy Bypass -File .\Install.ps1 -FirefoxExtensionId 'detect.expert@detect.expert'`.

### Your extension ID

- Store version: `obbkkjmpgaajcggbhajpdeeadkkchbeo`.
- Unpacked or local build: a different ID, shown on the Proxy tab (Companion, "Setup steps") and on `chrome://extensions` with Developer mode on. Chrome derives it from the folder you loaded, so moving the folder changes it.

The ID has to match exactly. If the extension can't find the companion, check the ID first.

## Is the download genuine?

The executables are signed by **Vektor T13 Technologies B.V.** Check them:

```powershell
Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
  Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
```

You want `Valid` and a signer starting with `CN=Vektor T13 Technologies B.V.`. You can also compare the ZIP's SHA-256 (`Get-FileHash <file> -Algorithm SHA256`) with the one in the release notes.

## About `-ExecutionPolicy Bypass`

The two `.ps1` scripts aren't code-signed, and a default Windows setup won't run scripts at all. `-ExecutionPolicy Bypass` lifts that for this one PowerShell process only, so your system policy stays as it was. The scripts are short and readable, so open `Install.ps1` in Notepad first if you like.

## Using it

1. Add or import your profile in the **Proxy** tab. When you save the first protected profile, the extension asks for the optional `nativeMessaging` permission. Allow it.
2. Press **Check visible profiles** to test it. This works even while Proxy is off.
3. Select the profile and press **Connect**.

The browser talks to a local relay on `127.0.0.1`, and the relay talks to your server. Your login stays in a file encrypted with Windows DPAPI under `%APPDATA%\Detect.Expert\Proxy\`. The extension itself only keeps names, addresses and ports.

Gotchas:

- **Profiles are per extension ID.** The unpacked build and the Store build keep separate saved profiles.
- **Plain `http` proxies send your login unencrypted** to the proxy, and many of them only allow `CONNECT` to port 443. Prefer `https` or SOCKS5.
- **Kill Switch.** If the helper dies while Proxy is on, traffic through the profile is blocked, not sent directly. Turn Proxy off to get your normal connection back.

## Remove it

Turn **Proxy** off in the extension first, then:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<your folder>\Uninstall.ps1"
```

This removes **only the registry entries**. To delete the files and your saved profiles as well:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"     # logins, passwords, VLESS links, OpenVPN configs: gone for good
```

More: [companion README](../../companion/README.md), [FAQ](faq.md).
