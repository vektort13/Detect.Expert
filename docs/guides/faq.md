# FAQ

[English](faq.md) · [Русский](faq.ru.md)

Short answers, no fluff. If yours isn't here, [open an issue](https://github.com/vektort13/Detect.Expert/issues).

## The basics

### Is it in the Chrome Web Store?

The listing is under review: [chromewebstore.google.com/detail/obbkkjmpgaajcggbhajpdeeadkkchbeo](https://chromewebstore.google.com/detail/obbkkjmpgaajcggbhajpdeeadkkchbeo). Until it's published, install from [Releases](https://github.com/vektort13/Detect.Expert/releases).

### Which browsers does it work in?

Chrome 153+ and Firefox 128+. Those are the two I test. Other Chromium browsers might work, but I can't promise anything. It doesn't run in incognito windows.

### Why is Firefox missing Firewall and Autosurfer?

Firewall is a Chrome-only module. Autosurfer drives its own window with Chrome's debugger API to do real scrolling and pointer moves, and the Firefox build doesn't support that. Everything else is there, though Browser Debug has fewer data sets and Antidetect doesn't rewrite request headers.

### Why does Firefox forget the extension after a restart?

You loaded it as a temporary add-on. A permanent install needs a Mozilla signature, and this release doesn't have one yet.

### What does "Allow user scripts" do, and why do I need it?

Antidetect and custom API values have to be in place before a page's own scripts run. I use Chrome's user-scripts API for that, and Chrome makes you switch it on yourself in the extension's Details page. Detector, Cookies, Proxy and the rest don't need it. In Firefox the same thing is the **Allow Custom** button (Firefox 137+).

## Privacy

### Does it send my data anywhere?

Not to me and not to anyone running analytics. There's no server of mine, no telemetry, no remote code. The extension only connects out when you use a feature that needs it: Cloudflare Precursor (your token, to `api.cloudflare.com`), the optional geolocation lookups (your key, to the provider you picked), a proxy or a proxy check, and an autosurfer run. The one thing it does on its own is re-request an already reported site icon, without a referrer. Details in [PRIVACY.md](../../PRIVACY.md).

### What leaves my machine if I switch on the geolocation lookups?

Only the public exit IP that a manual proxy check found, plus your key, sent to the provider you chose (MaxMind, ipgeolocation.io, ipdata or ip-api.com). No cookies, no referrer, no visited URLs, never a private address. Nothing is sent until you turn it on and add a key. ip-api.com without a key uses plain HTTP, so it asks for a separate confirmation.

### Where is my data stored, and how do I delete it?

Detector reports sit in the browser's session storage and disappear when you close the browser, with size and time limits besides. What you save yourself (Pro reports, Antidetect profiles, proxy metadata, settings) is stored in the browser profile on disk. Each tool has its own delete or clear button, and removing the extension removes its storage. Files you exported stay where you put them. The proxy companion's files and encrypted profiles stay too, see the [companion README](../../companion/README.md#uninstall). The full inventory is in [docs/data-inventory.md](../data-inventory.md).

## What it can and can't do

### Does Antidetect make me anonymous or invisible?

No, and I won't claim it. It changes what selected browser APIs and some request headers say about your browser, using values you choose or a device that the Randomize button builds for you. It doesn't change your IP address, the TLS fingerprint or the browser engine. Pages can notice wrappers, workers and server-side checks aren't covered, and a site that cross-checks several signals may still notice a mismatch. Treat it as a testing and privacy tool.

### Will it get me past anti-fraud systems or CAPTCHAs?

That's not what it's for, and I don't promise it. The Autosurfer never clicks, types or solves CAPTCHAs. The Detector doesn't judge sites either: a recognized service is not a verdict.

### "No services recognized" or "nothing found". Does that mean the page is clean?

No. It means nothing was seen in the part the extension can observe, during that period. Workers, WebAssembly, CSS and server-side checks are blind spots, and only verified signatures count as recognized. If the page loaded before you turned observation on, you also need to reload it.

### Can a site tell that I'm using the extension?

It can, at least in principle. The extension wraps browser APIs to watch or change them, and I don't try to hide that. No stealth tricks, no promises of 100% anything.

### A site broke after I blocked an API. Now what?

That happens: some sites really need the API. Set the row back to **As in preset** (or **Allow**) in API Guard and reload. If you used a Strict Antidetect preset, try Balanced or Compatibility.

### Why is the Cookies tab empty?

It reads nothing until you press **Grant access** and your browser's permission prompt is accepted. After that it lists the cookies of every store, with values hidden.

### Why does Chrome show a debugging banner while the Autosurfer runs?

The Autosurfer uses Chrome's debugger API in its own window for real scrolling and pointer moves. Chrome shows its banner whenever any extension does that. Press Stop and the banner goes away with the window.

## Proxy

### Do I need the companion?

Only for SOCKS5 with a password, HTTP/HTTPS with a login, VLESS and OpenVPN. Plain proxies work without it. See the [proxy companion guide](proxy-companion.md).

### The extension can't find the companion.

Check, in this order: the companion is installed for the same Windows user; you ran `Install.ps1` with the right extension ID (the Store version's ID is different from an unpacked build's); you allowed the `nativeMessaging` permission when saving the profile; then press **Check companion** again.

### I removed the companion and now there's no internet in the browser.

That's the Kill Switch: proxy-routed traffic is blocked when the proxy can't work, on purpose. Turn **Proxy** off in the extension.

### Is it a VPN for my whole computer?

No. It only handles the browser's own traffic. There's no TUN driver and nothing changes in your system routes.

## Other

### Are the translations reliable?

English and Russian are written by hand. The other 19 languages are drafts that no native speaker has checked yet; the shakiest spots are listed in [docs/translations.md](../translations.md). Fixes are welcome.

### What's the license?

MIT, see [LICENSE](../../LICENSE). The companion's engines (Xray-core, go-openvpn) have their own licenses, listed in the [companion README](../../companion/README.md#licenses).

### I found a security problem.

Please don't open a public issue. Use [GitHub Security Advisories](https://github.com/vektort13/Detect.Expert/security/advisories/new), see [SECURITY.md](../../SECURITY.md).
