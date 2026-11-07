# Changelog

All notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] - November 2026

A big release. Detect.Expert grows from an observation-only analyzer into the analyzer plus a set of opt-in test tools. Everything from 1.1.0 stays: Pro recording and the request map, cookie analysis, Google Tag Manager chains, social network detection, the beacon decoder and the Firefox build.

### Added

- **Control center** as the new start page: every module and its state, grouped as Analysis, Defense, Attack and Tools. Six themes, a `Ctrl K` command palette and a guided tour for each of the 12 Options sections (49 steps; tours change no settings).
- **API Guard** with 158 browser APIs in 12 groups, including the WebAssembly surfaces. Per API: *As in preset*, *Allow*, *Block* or *Custom value* (56 APIs take custom values). Global presets, per-site rules, JSON import and export with an import preview and undo.
- **Antidetect.**
  - Quick setup with three presets (Compatibility, Balanced, Strict) plus Device, OS, Browser and Network levels, and a generator for one consistent virtual device.
  - Profile-keyed noise for Canvas, audio, WebGL and Math results; selected Intl formatting, geolocation, storage quota, media codec and font-list behavior.
  - Request headers kept in line with the chosen identity (User-Agent, Accept-Language, Client Hints; Chrome only).
  - WebRTC metadata with separate IPv4 and IPv6 values, plus an optional browser WebRTC policy.
  - A library of up to 128 profiles with tags and notes, a 7-day trash and temporary identities.
  - An optional mode that keeps the Detector's sensors off while Antidetect is on.
  - It does not change your IP address, the TLS fingerprint or the browser engine, and the interface says so.
- **Firewall** (Chrome, opt-in, off until you switch it on): compares typed text with outgoing requests in memory, stops later requests by your decisions, spots session-recording signs, can send Global Privacy Control, optional local history.
- **Cookies workspace:** browse, create, edit and delete cookies across stores; import and export JSON, Netscape and Cookie-Editor files; password-encrypted export; preview before writing and undo.
- **Proxy manager:** SOCKS5, HTTP, HTTPS, VLESS and OpenVPN profiles, a kill switch, routing for all traffic or selected domains, manual checks with a history, bulk import and your own country tag per profile.
- **Proxy companion for Windows (x64):** password-authenticated SOCKS5, HTTP/HTTPS with a login, VLESS (Xray-core) and a userspace OpenVPN; per-user install, DPAPI-protected profiles, executables signed by Vektor T13 Technologies B.V.
- **Proxy Manager Geolocation API:** optional country, city, network and proxy/VPN flags for a proxy's exit IP from MaxMind, ipgeolocation.io, ipdata or ip-api.com, with your own key.
- **Autosurfer** (Chrome): your own queue of up to 200 URLs in a separate window, real scrolling and pointer movement, local resource measurements, and a catalog of 8,329 sites filterable by country, category and tracking system.
- **Browser Debug:** a window into 15 data sets of your own browser, each behind its own permission. Mostly reading, but some sets can also change things (history entry, bookmarks, tab pin and mute, privacy settings, site permissions).
- **Integrations:** read a Cloudflare zone's Precursor mode with your own token.

### Changed

- The interface was redesigned: calmer, with the Control center first.
- The Antidetect tab was reworked around Quick setup and four levels, with plainer labels for what sites are told.
- The Detector can now pick any open tab as its source and keeps a history of saved Pro reports.
- Minimum browser versions are Chrome 153 and Firefox 128.
- The extension pages' Content Security Policy now allows connections to seven hosts, used only by the Cloudflare and geolocation features above.

### Removed

- The Chrome DBSC diagnostic.

### Known limits

- The Detector doesn't cover Workers, WebAssembly, CSS or server-side checks.
- Pages can notice the extension's wrappers.
- Firefox: Firewall and Autosurfer are Chrome-only, header rewriting is Chrome-only, and this release is loaded as a temporary add-on until it has a Mozilla signature.
- The proxy companion is Windows x64 only.
- 19 of the 21 interface languages are drafts that native speakers haven't checked yet. See [docs/translations.md](docs/translations.md).
