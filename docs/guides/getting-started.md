# Getting started

[English](getting-started.md) · [Русский](getting-started.ru.md)

This is the no-fluff walk through the first ten minutes: install, see what a page does to your browser, then try the tools one by one. For the full feature list see the [README](../../README.md).

## 1. Install

Pick the package for your browser on the [Releases](https://github.com/vektort13/Detect.Expert/releases) page. The README has the exact steps for [Chrome and Firefox](../../README.md#installation).

Two things people miss:

- In Chrome, open the extension's **Details** page and switch on **Allow user scripts**. Antidetect and custom values in API Guard won't work without it. The Detector and Cookies don't need it.
- Chrome loads an unpacked extension straight from its folder. Don't delete that folder.

## 2. Open the Control center

Click the extension icon and use the gear in the popup (or open the extension's Options page from the browser's extensions menu). The Control center is the home screen: every module, whether it's on, and a button to open it. The modules in the **Defense** and **Attack** groups are off until you turn them on. Only the Detector is on from the start.

The **Tour** button in the header of each section runs a short tour of that section. It changes nothing, so it's safe to click around. `Ctrl K` opens a command palette if you'd rather type.

## 3. See what a page is doing (Detector)

1. Open any website in a normal window. (Incognito isn't supported.)
2. Click the extension icon. The popup shows the page's host, the observation state and a summary under **What was observed**.
3. For the full view open **Detector** in the Control center and pick the tab from the list.

How to read it:

- The two big counters, **Active identification** and **Passive identification**, split what the page did. A canvas read-back or a WebGL renderer query is a technique, not a verdict. One call proves nothing, a pattern might.
- **Spotted techniques** is the list. Expand a row for the details.
- **Recognized protection and identification services** only lists services the extension can verify. "No services recognized" does not mean there are none.
- The coverage note is the important bit. "Not observed" means "not seen in what I can watch". Workers, WebAssembly, CSS and server-side checks are blind spots.

Heads-up: a tab that was already open when you installed the extension, or opened before you turned observation on, starts late. Reload the page and look again.

## 4. Control what a page learns (API Guard)

1. Open **API Guard** and switch it on with the toggle in the header.
2. Pick a scope: **All sites** or a single **Site**.
3. Find an API (use the search box) and choose a mode for it:
   - **As in preset** follows the global preset (the default is *Limited*).
   - **Allow** leaves the API alone, even if the preset would block it.
   - **Block** stops the API from working for the page. Each API refuses in its own way.
   - **Custom value** returns a value you typed. Only 56 of the 158 APIs support it, and it only takes effect while Antidetect is on (API Guard's own switch controls blocking).
4. Reload pages that were already open. The UI tells you when it's needed ("Mode saved. Reload already open pages to apply it.").

Gotcha: blocking an API can break a site that really needs it (maps, video calls, payments). If a site acts up, set the row back to *As in preset* and reload.

## 5. Build a virtual device (Antidetect)

The checklist at the top of the Antidetect page walks you through it:

1. **Allow user scripts** in Chrome's extension settings (Firefox 137+: click **Allow Custom**).
2. **Turn Antidetect on** with the switch in the header.
3. **Apply a device:** open **Quick setup**, pick a preset (Compatibility, Balanced or Strict), press **Randomize** for a consistent device and press **Apply configuration**.

Reload the pages you want to test. The **Virtual device** card shows what sites are told.

What Antidetect does not change: your IP address, the TLS fingerprint and the browser engine. The page says so too. Workers and server-side checks aren't covered. It's a way to test and to reduce what a page can learn, not a promise of anonymity.

## 6. Add a proxy

1. Open **Proxy** and press **New profile** (or **Import list** for a pasted list, or **Choose .ovpn file**).
2. For a plain SOCKS5, HTTP or HTTPS proxy without a login, fill in the address and port and save.
3. Press **Check visible profiles** to test them. Results show speed, DNS/TLS flags and the exit IP.
4. Select a profile and press **Connect**. The **Kill Switch** is on by default: if the proxy fails, proxied requests are blocked instead of leaking out directly.

Logins, VLESS and OpenVPN need the Windows helper, see the [proxy companion guide](proxy-companion.md).

## 7. Look at your cookies

Open **Cookies** and press **Grant access**. Your browser asks for the cookies permission, and nothing is read before you agree. The list shows attributes and hides values. Press **Show** on a row to reveal one. You can create, edit, delete, import and export from here, with a preview before anything is written and an undo afterwards.

## Where next

- [FAQ](faq.md) for the usual questions and gotchas.
- [Proxy companion guide](proxy-companion.md) for the Windows helper.
- [PRIVACY.md](../../PRIVACY.md) for exactly what's stored and where.
- Found a bug or a bad translation? [Open an issue](https://github.com/vektort13/Detect.Expert/issues).
