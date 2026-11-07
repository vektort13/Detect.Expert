<div align="center">

[English](README.md) · [Русский](README.ru.md) · **繁體中文** · [Tiếng Việt](README.vi.md)

# Detect.Expert Proxy Companion

擴充功能 Proxy 分頁用的選用 Windows 輔助程式。

</div>

瀏覽器自己做不到某些代理功能：SOCKS5 密碼驗證、需要帳號的 HTTP/HTTPS 代理、VLESS、OpenVPN。這個輔助程式就是為了這些而存在。它是一支小程式，擴充功能透過瀏覽器的 native messaging 跟它溝通。只有擴充功能要用時才會啟動，以你的使用者身分執行，不會去動系統的其他部分。

不需要帳號的一般 SOCKS5、HTTP、HTTPS 設定檔用不到它，擴充功能會直接走瀏覽器自己的代理 API。

## 需求

- Windows 10 或 11，x64。
- Chrome 153+ 或 Firefox 128+ 上的 Detect.Expert 2.0.0。
- Windows PowerShell（系統內建）。不需要系統管理員權限。

其他系統：沒有密碼的直連 SOCKS5 在哪裡都能靠瀏覽器運作。要在其他系統上用原生 VLESS 和 OpenVPN，得另外建置並註冊該平台的輔助程式，還要有它自己的金鑰儲存機制。這個安裝包只支援 Windows。

## 安裝包裡有什麼

| 路徑 | 說明 |
|---|---|
| `detect-expert-proxy.exe` | 瀏覽器溝通的對象（Go 寫的）。負責本機中繼並啟動引擎。 |
| `engines/xray.exe` | 給 VLESS 用的 Xray-core v26.3.27（MPL-2.0）。 |
| `engines/openvpn2socks.exe` | 使用者空間的 OpenVPN，由 go-openvpn 加上我的修補檔建置而成（AGPL-3.0-or-later）。沒有 TUN 驅動，也不會改系統路由。 |
| `engines/source/` | 引擎的原始碼、修補檔、授權全文與建置說明。 |
| `source/companion/` | 主程式本身的原始碼。 |
| `Install.ps1`、`Uninstall.ps1` | 針對目前使用者的安裝與移除。 |
| `companion.json` | 安裝包內每個檔案的清單與 SHA-256，`Install.ps1` 會拿它來比對。 |
| `LICENSE` | 專案的 MIT 授權。引擎各有各的授權，見[授權](#授權)。 |

## 這真的是我發的嗎

三個可執行檔都由 **Vektor T13 Technologies B.V.**（荷蘭鹿特丹）以 Authenticode 簽章。安裝前請先驗證：

```powershell
Get-FileHash .\Detect.Expert-Proxy-Companion-windows-x64.zip -Algorithm SHA256   # 與發行說明比對
Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
  Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
```

`Status` 應該顯示 `Valid`，簽署者的 Subject 要以 `CN=Vektor T13 Technologies B.V.` 開頭。如果不是，請什麼都別執行，並告訴我。

另外，`Install.ps1` 在複製任何檔案之前，會先拿每個檔案跟 `companion.json` 比對。這能抓出下載損毀，但沒辦法證明是誰做的安裝包，因為 `companion.json` 本來就放在安裝包裡面。能證明的是簽章。

## 安裝

1. 從 [Releases](https://github.com/vektort13/Detect.Expert/releases) 下載 `Detect.Expert-Proxy-Companion-windows-x64.zip`。
2. 按右鍵選「**全部解壓縮**」，放在一般的位置，例如「下載」資料夾。別放進安裝程式之後要用的 `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion` 底下，不然腳本會停下來，顯示「Extract the package outside the installation directory first」。
3. 查出你的擴充功能 ID，方法看下一節。
4. 在解壓縮出來的資料夾開啟 PowerShell（在檔案總管網址列輸入 `powershell` 就行），執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
```

這個 ID 是 Chrome Web Store 版本的（上架頁面還在審核）。如果你是用未封裝的方式載入擴充功能，請換成你自己的 ID。

成功的話會看到 `Installed Detect Expert Proxy Companion: <資料夾>` 和 `Browser proxy settings, system routes and services were not changed.`。接著在擴充功能開啟 **Proxy** 分頁的 **Companion** 區塊，按「**Check companion**」。第一次儲存受保護的設定檔時，擴充功能會要求選用的 `nativeMessaging` 權限，請按允許，它就是靠這個連到輔助程式。

**只裝 Firefox：**

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -FirefoxExtensionId 'detect.expert@detect.expert'
```

沒有加 `-ChromeExtensionId` 就只註冊 Firefox；加了的話，Chrome、Chromium、Microsoft Edge 和 Firefox 會一次全部註冊。

### 該用哪個 ID

- **Chrome Web Store 版本：** `obbkkjmpgaajcggbhajpdeeadkkchbeo`。
- **未封裝或本機載入的版本：** ID 不一樣，因為 Chrome 是依你載入的資料夾算出來的。可以在擴充功能的 Proxy 分頁（Companion 的「Setup steps」）看到，或到 `chrome://extensions`、開啟開發人員模式後，在擴充功能名稱下方找到。它是 32 個 `a` 到 `p` 的字母。

踩雷提醒：ID 必須一個字都不差，因為輔助程式只回應註冊時指定的那個擴充功能。設定檔是依擴充功能 ID 分開存的，所以未封裝版本和商店版本各有各的已儲存設定檔。換不同的 ID 再安裝一次，會多出第二個資料夾，註冊會指向最新的那個。

## 為什麼指令裡有 `-ExecutionPolicy Bypass`

`Install.ps1` 和 `Uninstall.ps1` 是純文字腳本，而且**沒有**做 Authenticode 簽章。一般的 Windows 10/11 上，PowerShell 預設的執行原則根本不允許跑腳本，從網路下載的檔案還會被標上「來自網際網路」。所以上面的指令用 `-ExecutionPolicy Bypass` 啟動 PowerShell。它只對那一個處理序有效，不會改你電腦或使用者層級的原則。

腳本很短，建議執行前先把 `Install.ps1` 看過一遍，它本來就是寫成讓人讀得懂的。如果不想用 Bypass，可以先讀完腳本，把解壓縮出來的檔案解除封鎖（`Get-ChildItem -Recurse | Unblock-File`），再用你覺得合適的原則去執行。

## 安裝程式做了什麼

- 拿每個檔案跟 `companion.json` 比對。
- 把安裝包複製到 `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion\<版本>-<安裝包>-<ID>\`。
- 在那裡寫入 `allowed-callers.json`：記錄允許跟輔助程式溝通的擴充功能 ID。其他來源呼叫的話，它會直接結束。
- 在檔案旁邊放好 native messaging manifest，並註冊到 `HKCU\Software\...\NativeMessagingHosts\com.detect_expert.proxy`。有給 Chrome ID 的話，會寫 Google\Chrome、Chromium 和 Microsoft\Edge 這幾個機碼；Firefox 則是 Mozilla。

它不會要求系統管理員權限、不裝服務、不設自動啟動、不加驅動程式、不改系統路由，也不改瀏覽器的代理設定。瀏覽器的代理設定是擴充功能改的，而且只在你按下 Connect 時才改（或是你開了「Connect when the browser starts」）。

## 運作方式

瀏覽器透過 native messaging 啟動 `detect-expert-proxy.exe`。遇到受保護的設定檔時，輔助程式會在 `127.0.0.1` 開一個隨機埠的本機 SOCKS5 中繼，瀏覽器就改連到它。接下來：

- **有密碼的 SOCKS5** 與 **有帳號的 HTTP/HTTPS：** 由中繼去登入你的伺服器。HTTP 和 HTTPS 代理會收到帶 Basic 驗證的 `CONNECT`。只支援 Basic，而且一般的 `http` 會讓帳密以明文在網路上傳送，所以能用 `https` 或 SOCKS5 就盡量用。很多 HTTP 代理只允許 `CONNECT` 到 443 埠；如果 80 埠被拒絕，你會看到 `proxy-denied`。
- **VLESS：** 由固定版本的 Xray 維持隧道。設定檔會依白名單欄位轉成 Xray 設定。不接受任意的 Xray JSON，也不接受不安全的 TLS。
- **OpenVPN：** 使用者空間的用戶端，有自己的網路堆疊。DNS 只走隧道。

引擎是以子處理序的方式，在 Windows Job Object 裡啟動的，所以會跟著輔助程式一起結束，就算當掉也一樣。設定檔透過 stdin 交給引擎，帳密透過私有環境變數，不會寫出明文設定檔。執行期間引擎不會下載或更新任何東西。

Kill Switch 一直開著：輔助程式或隧道出問題時，走代理的請求會被擋掉，不會直連出去。

已儲存的設定檔，每個擴充功能 ID 一個檔案，放在 `%APPDATA%\Detect.Expert\Proxy\`，由 Windows DPAPI 針對你的 Windows 使用者加密。擴充功能自己的儲存空間只留名稱、位址、埠號和路由，絕不會有帳號或密碼。

輔助程式不會回傳任何東西給我。它只會在你連線或執行檢查時，連到你設定檔裡的伺服器。

## 更新

下載新的安裝包，用同一個 ID 再執行一次 `Install.ps1`。你的設定檔不會動。新的安裝包會裝進新資料夾，註冊會搬過去，舊資料夾可以刪掉。

## 解除安裝

先在擴充功能裡把 **Proxy** 關掉。接著從已安裝的那份執行移除程式：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<你的資料夾>\Uninstall.ps1"
```

`<你的資料夾>` 換成安裝程式印出來的資料夾名稱。（也可以用 `Get-ChildItem "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"` 列出來。）

先講白了它會刪什麼：**只會移除那次安裝的登錄機碼**。程式檔案和你加密的設定檔都還在。這是故意的，重新安裝才不會把你的伺服器清單洗掉。如果想全部清乾淨，請手動刪除：

```powershell
# 程式檔案（所有已安裝的版本）
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"

# 加密的設定檔：帳號、密碼、VLESS 連結、OpenVPN 設定。刪了就救不回來。
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"
```

如果擴充功能裡 Proxy 還開著，你就把輔助程式拿掉，經過那些設定檔的流量會被擋住，直到你把 Proxy 關掉。這是 Kill Switch 在做它該做的事。

## 限制

- 只支援 Windows x64，而且只處理瀏覽器自己的流量，不是全系統的 VPN。
- 我的自動化測試都是對本機迴路（loopback）伺服器跑的，沒有試過每一家商用的 OpenVPN 或 VLESS 服務。如果你的設定檔連不上，請開個 issue 說明是哪一種類型，記得不要附上帳密。
- 連線檢查是手動、一次性的：透過選定的代理送出一個請求，目標位址可以自己改。

## 授權

專案（包含主程式）採用 MIT 授權，見安裝包內的 `LICENSE`。引擎是各自獨立的程式：

- **Xray-core**：MPL-2.0。
- **go-openvpn**（打過修補檔，檔名 `openvpn2socks.exe`）：AGPL-3.0-or-later。

它們的完整原始碼、我的修補檔與授權全文都在 `engines/source/`，要重新建置可以看 `BUILD-SOURCE.md`。`engines/pins.json` 列出確切的版本與檢查碼。

## 自己建置

需要 Windows x64、Node.js 24 或 25，以及這個儲存庫。

```powershell
node scripts/build-proxy-engines.mjs     # 下載固定版本的 Go、Xray 與 go-openvpn 原始碼，檢查 SHA-256，並建置引擎
node scripts/build-proxy-companion.mjs   # vet 與測試、建置 detect-expert-proxy.exe、寫入 companion.json、打包成 ZIP
```

輸出位置：`release/proxy-native/windows-amd64/` 與 `release/Detect.Expert-Proxy-Companion-windows-x64.zip`。只有在你執行引擎腳本時才會下載東西。自己建置的版本沒有簽章，正式發行的檔案則是另外簽章。
