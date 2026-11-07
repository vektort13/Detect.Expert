# Proxy manager and the Windows companion

**English** · [Русский](ru/07-proxy-and-companion.md)

This is the Proxy tab: a list of your proxy profiles, a few checks you run by hand, and one switch that points the browser at a profile. For logins, VLESS and OpenVPN you also need a small Windows helper, the companion. I'll go through both here, with the traps I know about.

## What it's for

- Keep up to 100 profiles of five types: SOCKS5, HTTP, HTTPS, VLESS and OpenVPN.
- Send all browser traffic through one profile, or only traffic to domains you list.
- Test a profile by hand and see speed, DNS and TLS flags and the exit IP. The results stay in a local history.
- Cut the connection off (not fall back to direct) when the proxy dies. That's the Kill Switch, and it's always on.

It handles the browser's own traffic and nothing else. No system-wide VPN, no driver, no changes to your Windows routes.

## Before you start

The Proxy tab works in Chrome and Firefox. The companion is Windows 10/11 x64 only.

Do you need the companion? It depends on the profile:

| Your proxy | Companion needed? |
|---|---|
| SOCKS5, HTTP or HTTPS without a login | Not to connect. The browser does it. |
| SOCKS5 with a password | Yes |
| HTTP or HTTPS with a login | Yes |
| VLESS | Yes |
| OpenVPN (`.ovpn`) | Yes |

Heads-up about the check buttons: in this version the built-in test is run by the companion, for every profile type. A plain SOCKS5, HTTP or HTTPS proxy without a login connects without it, but it can't be tested with the built-in check unless the companion is installed. I tried it on a machine with no companion: with the optional `nativeMessaging` permission granted, **Check visible profiles** on five demo profiles, plain SOCKS5 and HTTP ones included, ended with "Checked 5 of 5: 0 responded, 5 failed." and every row said **Check failed** with "The tunnel disconnected." and the code `native-disconnected`. That message is what a missing companion looks like.

Nothing is contacted until you press something. Opening the tab, adding a profile or importing a list sends no request.

## Step by step

### 1. Open Proxy and read the route card

Open the Control center, then **Proxy** in the left menu. The top card is the route: what the browser does with traffic right now.

![The Proxy tab: route card with state, selected profile, routing mode, Connect and the protection tiles](../../assets/manual/07/01-overview.png)

① the main **Proxy** switch · ② the state chip (**Off** until you connect) · ③ the profile the route will use · ④ **All browser traffic** or **Selected domains only** · ⑤ **Connect** · ⑥ **Kill Switch**, locked on · ⑦ **Restrict WebRTC to proxy-compatible connections**, next to **Disable network prediction** and **Connect when the browser starts** · ⑧ the three sections that fold open: **Routing**, **Connection analyzer**, **Companion**

The state chip can say **Off**, **Connecting**, **Connected**, **Traffic blocked**, **Connection error**, **Controlled elsewhere** (another extension or a policy owns the browser's proxy settings, and I don't overwrite that) or **Access required**.

The download icon in the header (**Export profile metadata JSON**) exports the profile metadata as JSON: names, addresses, ports and settings, no credentials. The **Tour** button beside it runs a short walk through this section.

The three tiles under the route line are a draft. Flip one and an **Unsaved changes** bar appears with **Save** and **Cancel**. Nothing applies until you save. The WebRTC tile and the network prediction tile both change browser privacy settings, so both need the optional `privacy` permission. The **Grant access** button in the **Routing** section asks for it, and so does **Connect** when one of these tiles is on.

### 2. Add a profile

Scroll down to **Profiles**. The toolbar has everything you need.

![The profile list toolbar with the New profile menu open](../../assets/manual/07/02-add-menu.png)

① search (press `/` to jump to it) · ② **Check visible profiles** · ③ **New profile** · ④ the arrow next to it: **New profile: SOCKS5**, **Import list**, **Choose .ovpn file** · ⑤ the **...** menu · ⑥ the **?** help

Press **New profile**. A sheet opens.

![The Add sheet with a made-up SOCKS5 profile filled in](../../assets/manual/07/03-profile-sheet.png)

① pick the type: SOCKS5, HTTP, HTTPS, VLESS or OpenVPN · ② **Paste connection details**, then **Parse**, fills the fields from one pasted line · ③ the name · ④ host and port · ⑤ **Random session** builds a random session tag for providers that want one in the login · ⑥ the password, with a show/hide eye · ⑦ **Save**

The values in the picture are made up (`203.0.113.77` is a documentation address, the password is a placeholder). The sheet changes with the type: VLESS wants a **VLESS link**, OpenVPN wants an **OpenVPN configuration** (paste it, or use **Choose .ovpn file**).

There is also **Country tag (optional)**. It's your own note. The extension never detects a country from an IP address and never fills it in. Antidetect can read it later to hint at a mismatch with your time zone and language.

Save the profile and its row appears in the list. Passwords and keys don't go into the extension's storage. Names, addresses and ports do, and the logins stay in the companion's encrypted file (more on that below).

### 3. Import a list

If you have a pile of proxies, use **Import list** from the same menu. One profile per line:

```text
203.0.113.31:1080 #Frankfurt
203.0.113.32:1080:demo-user:demo-pass #Berlin
socks5://demo-user:demo-pass@203.0.113.33:1080 #Paris
http://203.0.113.34:8080 #Madrid
```

A scheme (`socks5://`, `http://`, `https://`, `vless://`) names the type. Text after a space and `#` becomes the profile name. For lines without a scheme you choose the field order: `host:port:user:password` or `user:password:host:port`, and the default type.

Press **Parse** and you get a preview, not a save.

![Import list, preview step: counters and a table with a state for every line](../../assets/manual/07/04-bulk-preview.png)

① **Recognized**, **Errors**, **Duplicates**, **Free slots** · ② every line with its state; a bad line says why (**Unrecognized line**, **Invalid host or IP address**, **Port is missing or outside 1–65535** and so on) · ③ **Select all ready rows** · ④ **Save selected** · ⑤ **Back**

Pasted text and the parsed lines live only in this page's memory. The preview shows the username, never the password. Close the dialog and everything is wiped. Up to 100 profiles can be saved in total, so you can't select more rows than there are free slots.

After saving you get **Check imported** and **Delete failed**. The second one removes only the profiles from this import that failed the last check.

### 4. Check profiles and read the list

**Check visible profiles** runs a manual check on every profile the current filters show, and you can cancel it midway. For each one the companion opens a connection through that proxy and fetches the address in the **Test URL** field (the **Connection analyzer** section; the default is `https://api.ipify.org/?format=json`, and you can change it). So a check sends one request to that address, through the proxy, and nothing else. It doesn't switch your browser route.

![The profile list with filters, check results, exit IP and the Columns menu](../../assets/manual/07/05-list-columns.png)

① filter chips by type, with counts · ② filter chips by check result: **All**, **Working**, **Failed**, **Unchecked** · ③ the result: a speed label (**Fast**, **Medium** or **Slow**) with milliseconds, plus **DNS** and **TLS** flags when the check could confirm them; a failure shows **Check failed** and a short code such as `timeout` · ④ **Exit IP**, the address the test site saw · ⑤ density: **Comfortable** or **Compact** · ⑥ **Columns**, a menu that shows or hides columns · ⑦ **Sort by**, with a button to reverse the order

The **Columns** menu lists **Type**, **Address**, **Country**, **Fingerprint profiles**, **Check result**, **Remote IP address** (that's the **Exit IP** column), **Checked**, and **Reset view**. When the geolocation API is set up there is a second group in it, see [Integrations](11-integrations.md).

The **Country** button next to the sort control filters the list by the country tags you set. A profile that was never checked stays **Not checked**. I don't guess. The row's country chip is your own tag, not a detected one.

On a narrow window the rows turn into cards. The keyboard works too: arrows move, `Space` selects, `Enter` opens details, `C` checks, `Delete` removes, `/` searches. Select a few rows and a bar appears with **Check selected**, **Delete selected** and **Clear selection**.

Under the list there's **Save check history**. With it on, the result of each manual check is kept on this computer: result, time, response time, DNS/TLS flags, HTTP status and the exit IP, up to 30 entries per profile for 30 days. It never holds the checked address, the response, credentials or the proxy host, and it's never sent anywhere or included in exports. **Clear all check history** wipes it. Changing a profile's connection clears that profile's history too.

### 5. Open a profile

Click a profile's name to open its details panel.

![The details panel of one profile](../../assets/manual/07/06-details.png)

① **Connect** · ② **Check connection** · ③ **Copy address** · ④ **Copy full JSON with credentials** · ⑤ **Edit** · ⑥ **Duplicate without credentials** · ⑦ **Delete**

The panel also has the profile's check history (with a small latency sparkline once there are two or more entries) and a notice **Exit IP changed** when the last good check showed a different exit address than the one before.

Heads-up on ④: that button puts the whole profile on the clipboard, login, password and keys included. It asks for the optional `clipboardWrite` permission when you press it, and the secrets live in memory only until they're copied. Don't paste that JSON anywhere you wouldn't paste the password itself.

### 6. Choose what goes through the proxy

Open **Routing** in the route card.

![The route card with Selected domains only and the Routing section open](../../assets/manual/07/07-routing.png)

① **All browser traffic** sends everything through the proxy, **Selected domains only** sends just the domains you list · ② **Proxy domains**, an exact host or `*.domain` · ③ **Direct domains**, the same format · ④ **Bypass local addresses** · ⑤ **Grant access** for the `privacy` permission · ⑥ the **Unsaved changes** bar

Sites on the direct list connect without the proxy. They see your real IP address and your usual DNS resolves them. That's the point of the list, and also why I wrote it on the screen.

With the proxy on, names are resolved through the proxy (**DNS through the proxy**), not by your system.

### 7. Connect, and what the Kill Switch does

1. Press **Connect** for the profile you want: in its details panel, or in the actions of its row. That profile becomes the selected one, the route card shows it with a **Disconnect** button, and the connection starts. Connect also asks for the optional permissions it needs: `nativeMessaging` for profiles that use the companion, `privacy` if the WebRTC or network prediction tile is on. When a profile is already selected, **Connect** on the route card connects that one. If none is, the card says "Select a profile from the list to connect."
2. The chip goes **Connecting**, then **Connected**.
3. To check the live route, open **Connection analyzer** and press **Check connection**. It runs through the profile you're connected to and shows **Remote IP address**, **HTTP status**, **DNS**, **TLS** and **Elapsed time**.
4. **Disconnect**, or the main **Proxy** switch, puts the browser back on its normal connection.

For HTTP and HTTPS proxies with a login, **Connected** only means the proxy answered (for HTTPS also that its certificate is fine). The login itself is verified by the first real request or by **Check connection**. I say so on the screen, and I'm saying it here too.

The **Kill Switch** is the reason you won't leak by accident: if the proxy, the tunnel or the companion fails while Proxy is on, requests that were meant for the proxy are blocked, not sent directly. The chip says **Traffic blocked**. To get your normal connection back, turn Proxy off.

**Connect when the browser starts** reconnects on its own at startup. Leave it off if you'd rather press the button yourself.

### 8. Install the companion (Windows only)

Skip this whole section if all your profiles are plain proxies without a login and you don't plan to use the built-in check.

![The Companion section open, with the install steps and the missing-companion banner](../../assets/manual/07/08-companion.png)

① the status: **Companion not installed or unavailable** until you install it · ② the two install steps, with your own extension ID filled into the command · ③ **Download from GitHub** (a plain link to the Releases page, it opens in a new tab; the extension never downloads or installs anything by itself) · ④ **Grant access** for the optional `nativeMessaging` permission · ⑤ **Check companion** · ⑥ the notice under the route card, **Some proxy types need extra software**, with its own download link · ⑦ the banner below it, with **Setup steps** and **Check companion**

Here is the whole path. The long version, with every detail, is in the [proxy companion guide](../guides/proxy-companion.md) and the [companion README](../../native/proxy/README.md).

1. **Download.** Get `Detect.Expert-Proxy-Companion-windows-x64.zip` from [Releases](https://github.com/vektort13/Detect.Expert/releases).
2. **Check the download.** Compare the ZIP's hash with the one in the release notes, then check the signature of the executables. You want `Valid` and a signer that starts with `CN=Vektor T13 Technologies B.V.`:

   ```powershell
   Get-FileHash .\Detect.Expert-Proxy-Companion-windows-x64.zip -Algorithm SHA256
   Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
     Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
   ```

3. **Extract** it to an ordinary folder such as Downloads. Not into `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion`, the script refuses that.
4. **Find your extension ID.** The Chrome Web Store build has `obbkkjmpgaajcggbhajpdeeadkkchbeo`. An unpacked build has a different one, and Chrome derives it from the folder you loaded, so moving the folder changes it. The Companion section shows the exact command with your ID in it, and `chrome://extensions` shows the ID too (Developer mode on).
5. **Install.** Open PowerShell in the extracted folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId <your extension ID>
   ```

   `-ExecutionPolicy Bypass` applies to this one PowerShell process only. The script isn't signed and Windows won't run unsigned scripts by default, so I use it. It's short; read it first if you like. For Firefox use `-FirefoxExtensionId 'detect.expert@detect.expert'` instead.
6. **Check.** Back in the extension press **Check companion**. When you save your first profile that needs the companion, the browser asks for the optional `nativeMessaging` permission. Allow it, that's how the extension reaches the helper. The first time in Chrome you may also need **Restart extension** once, with Proxy off. The page says so and reopens itself.

The ID has to match exactly. If the extension can't find the companion, that's the first thing to look at.

What the installer does: it copies the files to `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion\`, registers the native messaging host for the current Windows user, and lists which extension IDs may talk to it. No admin rights, no service, no autostart, no driver, no changes to system routes or to the browser's proxy settings (the extension changes those, and only when you press **Connect**).

How the logins are kept: the companion stores them in one file per extension ID, encrypted with Windows DPAPI for your Windows user, under `%APPDATA%\Detect.Expert\Proxy\`. The extension keeps only names, addresses and ports.

### 9. Remove the companion

Turn **Proxy** off in the extension first. Then:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<your folder>\Uninstall.ps1"
```

That removes only the registry entries. The program files and your saved profiles stay, on purpose, so a reinstall doesn't wipe your servers. To delete everything:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"   # logins, passwords, VLESS links, OpenVPN configs: gone for good
```

If you remove the companion and leave Proxy on, the Kill Switch blocks proxied traffic until you turn Proxy off. That's it working, not a bug.

## Tips and gotchas

- **Profiles belong to an extension ID.** The unpacked build and the Store build keep separate saved profiles.
- **Plain `http` proxies send your login unencrypted** on the way to the proxy, and many of them allow `CONNECT` only to port 443. Prefer `https` or SOCKS5. An HTTP proxy also sees the host name of every connection.
- **Digest, NTLM and Negotiate** logins aren't supported. HTTP and HTTPS proxies get Basic authentication through the companion.
- **WebRTC.** With **Restrict WebRTC to proxy-compatible connections** on, calls work only through TURN servers over TCP via the proxy, so some sites' calls won't connect. Turn it off if a call matters more than the leak protection.
- **The relay carries TCP only.** UDP and QUIC to sites aren't carried by it.
- **The p0f/TCP fingerprint** that sites see belongs to whoever opens the connection to them: the proxy server for SOCKS5, HTTP, HTTPS and VLESS, the companion's own network stack for OpenVPN. The extension doesn't change it.
- **Another OpenVPN is already running?** Checking a different OpenVPN profile is refused until you disconnect it, so the server doesn't drop your session.
- **Session tags.** **Random session** replaces a `{session}` token with 10 random characters. Check your provider's format, because I can't know it.

## What it does NOT do

- It doesn't check IP addresses by itself. No timers, no automatic checks, no subscriptions, no updates of engines.
- It isn't a system VPN. Only browser traffic goes through it.
- It doesn't detect a country, and a **Country** chip is only what you typed.
- It doesn't promise that a site won't spot a proxy, a VPN or a data-centre address. A site can, and the extension changes nothing about that.
- It doesn't make you anonymous.

## Next

Geolocation of the exit IP, the optional extra, is on the [integrations page](11-integrations.md). To pair a proxy with a browser identity see [Antidetect](06-antidetect.md).

← [Antidetect](06-antidetect.md) · [Index](README.md) · [Cookies](08-cookies.md) →
