# Detect.Expert: illustrated manual

**English** · [Русский](ru/README.md)

This is the step-by-step guide I wish I'd had when I started using my own extension. One page per feature, with numbered pictures, so you can follow along with the browser open next to it. No fluff, and where something doesn't work or can't be done, the page says so in plain words.

If you only want the ten-minute version, read [Getting started](../guides/getting-started.md) instead. This manual is the long one.

## Where to start

| If you want to | Read |
|---|---|
| install it and get past the first-run switches | [01. Install and first run](01-install-and-first-run.md) |
| understand the home screen, tours and search | [02. Control center and tours](02-control-center-and-tours.md) |
| see what a page asks your browser | [03. Detector](03-detector.md) |
| allow, block or change what an API answers | [04. API Guard](04-api-guard.md) |
| compare what you type with outgoing requests (Chrome) | [05. Firewall](05-firewall.md) |
| build one consistent virtual device | [06. Antidetect](06-antidetect.md) |
| send the browser through a proxy, install the Windows helper | [07. Proxy and companion](07-proxy-and-companion.md) |
| look at, edit, import and export cookies | [08. Cookies](08-cookies.md) |
| walk a list of sites in a separate window (Chrome) | [09. Autosurfer](09-autosurfer.md) |
| look at your browser's own data (and fix some of it in place) | [10. Browser Debug](10-browser-debug.md) |
| connect a Cloudflare zone, add geolocation for proxy IPs | [11. Integrations](11-integrations.md) |
| know what is stored where, and delete it | [12. Settings and privacy](12-settings-privacy.md) |
| fix something that doesn't work | [13. Troubleshooting](13-troubleshooting.md) |

New here? Read 01, then 02 and 03. The rest you can open in any order. Pages 05 and 09 are for Chrome only, and 06 needs one switch in Chrome's extension settings (page 01 shows it).

## How to read the pages

- **Pictures have numbered circles.** The number in a circle is explained in the line right under the picture: ① is the first circle, ② the second, and so on. The words are in the text, not in the picture, so the same picture works in every language.
- **Bold is a button, tab, field or switch**, spelled exactly as in the English interface, which is what the screenshots show. In the Russian pages I add the Russian name in guillemets when I know it for sure.
- **`Code style` is something you type or a file name.**
- **Heads-up and Gotcha** mark traps I've seen people fall into. **What it does NOT do** is on every page, because I'd rather you hear a limit from me than find it out the hard way.
- **Demo data only.** The screenshots come from a clean browser profile with made-up data: addresses from the documentation ranges (203.0.113.x, 198.51.100.x), example.com, example.org and example.net, invented cookie and proxy names. Light theme (Pearl) unless a picture says otherwise.
- **Chrome and Firefox.** Where a feature works in one browser only, the page says so in "Before you start".

## The rules the whole extension follows

I repeat these on the pages where they matter, but here they are in one place:

- It informs. The Detector never changes what a page gets, and a recognized service name is not a verdict about a site.
- "Not observed" means "not seen in what I can watch, during that period". Workers, WebAssembly, CSS and server-side checks are blind spots.
- Everything beyond the Detector is opt-in and off until you turn it on.
- Nothing is sent to me. The network is used only when you ask for something that needs it.
- Pages can notice the wrappers the extension installs. I don't promise invisibility, anonymity or that any particular check will pass.

## Related

[README](../../README.md) · [Getting started](../guides/getting-started.md) · [Proxy companion guide](../guides/proxy-companion.md) · [FAQ](../guides/faq.md) · [Privacy](../../PRIVACY.md)
