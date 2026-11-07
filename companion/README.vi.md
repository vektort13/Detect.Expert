<div align="center">

[English](README.md) · [Русский](README.ru.md) · [繁體中文](README.zh-Hant.md) · **Tiếng Việt**

# Detect.Expert Proxy Companion

Ứng dụng bổ trợ tùy chọn cho Windows, dành cho tab Proxy của tiện ích.

</div>

Trình duyệt tự nó không làm được vài việc về proxy: SOCKS5 có mật khẩu, proxy HTTP/HTTPS có tài khoản, VLESS, OpenVPN. Ứng dụng này sinh ra để lo mấy việc đó. Nó là một chương trình nhỏ, tiện ích nói chuyện với nó qua native messaging của trình duyệt. Nó chỉ chạy khi tiện ích gọi, chạy bằng quyền người dùng của bạn và không đụng tới phần còn lại của hệ thống.

Với các hồ sơ SOCKS5, HTTP, HTTPS thường không có tài khoản thì không cần tới nó: tiện ích xử lý bằng API proxy có sẵn của trình duyệt.

## Yêu cầu

- Windows 10 hoặc 11, x64.
- Detect.Expert 2.0.0 trên Chrome 153+ hoặc Firefox 128+.
- Windows PowerShell (có sẵn trong Windows). Không cần quyền quản trị.

Hệ điều hành khác: SOCKS5 trực tiếp không mật khẩu chạy qua trình duyệt ở đâu cũng được. VLESS và OpenVPN gốc ở đó sẽ cần một ứng dụng bổ trợ được build và đăng ký riêng cho nền tảng đó, kèm kho khóa riêng. Gói này chỉ dành cho Windows.

## Trong gói có gì

| Đường dẫn | Là gì |
|---|---|
| `detect-expert-proxy.exe` | Chương trình mà trình duyệt nói chuyện với (viết bằng Go). Dựng relay cục bộ và khởi chạy các engine. |
| `engines/xray.exe` | Xray-core v26.3.27 cho VLESS (MPL-2.0). |
| `engines/openvpn2socks.exe` | OpenVPN ở không gian người dùng, build từ go-openvpn cùng các bản vá của mình (AGPL-3.0-or-later). Không có driver TUN, không đổi route của hệ thống. |
| `engines/source/` | Mã nguồn các engine, bản vá, văn bản giấy phép và hướng dẫn build. |
| `source/companion/` | Mã nguồn của chính chương trình host. |
| `Install.ps1`, `Uninstall.ps1` | Cài đặt và gỡ cho người dùng hiện tại. |
| `companion.json` | Danh sách mọi tệp trong gói kèm SHA-256, `Install.ps1` đối chiếu theo nó. |
| `LICENSE` | Giấy phép MIT của dự án. Các engine có giấy phép riêng, xem [Giấy phép](#giấy-phép). |

## Có đúng là của mình không

Ba tệp thực thi được ký (Authenticode) bởi **Vektor T13 Technologies B.V.** (Rotterdam, Hà Lan). Hãy kiểm tra trước khi cài:

```powershell
Get-FileHash .\Detect.Expert-Proxy-Companion-windows-x64.zip -Algorithm SHA256   # đối chiếu với ghi chú phát hành
Get-ChildItem -Recurse -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName } |
  Format-Table Path, Status, @{n='Signer'; e={$_.SignerCertificate.Subject}} -AutoSize -Wrap
```

`Status` phải là `Valid`, và Subject của chữ ký phải bắt đầu bằng `CN=Vektor T13 Technologies B.V.`. Nếu không đúng, đừng chạy gì cả và báo cho mình.

Ngoài ra, `Install.ps1` đối chiếu từng tệp với `companion.json` trước khi chép bất cứ thứ gì. Việc đó bắt được lỗi tải hỏng, nhưng không chứng minh ai làm ra gói, vì `companion.json` nằm ngay trong gói. Thứ chứng minh là chữ ký.

## Cài đặt

1. Tải `Detect.Expert-Proxy-Companion-windows-x64.zip` từ trang [Releases](https://github.com/vektort13/Detect.Expert/releases).
2. Nhấp chuột phải, chọn **Extract All**, giải nén vào chỗ bình thường như thư mục Downloads. Đừng giải nén vào đúng thư mục mà trình cài đặt sẽ dùng dưới `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion`, nếu không script sẽ dừng với thông báo "Extract the package outside the installation directory first".
3. Tìm ID tiện ích của bạn. Cách tìm ở mục ngay dưới.
4. Mở PowerShell trong thư mục vừa giải nén (gõ `powershell` vào thanh địa chỉ của File Explorer là được) rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ChromeExtensionId obbkkjmpgaajcggbhajpdeeadkkchbeo
```

ID này là của bản trên Chrome Web Store (trang đó vẫn đang chờ duyệt). Nếu bạn nạp tiện ích dạng chưa đóng gói, hãy thay bằng ID của chính bạn.

Bạn sẽ thấy `Installed Detect Expert Proxy Companion: <thư mục>` và `Browser proxy settings, system routes and services were not changed.` Sau đó mở tab **Proxy** của tiện ích, mục **Companion**, bấm **Check companion**. Khi bạn lưu hồ sơ được bảo vệ đầu tiên, tiện ích sẽ xin quyền tùy chọn `nativeMessaging`. Cứ đồng ý, nó cần quyền này để nói chuyện với ứng dụng.

**Chỉ Firefox:**

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -FirefoxExtensionId 'detect.expert@detect.expert'
```

Không có `-ChromeExtensionId` thì chỉ Firefox được đăng ký. Có nó thì Chrome, Chromium, Microsoft Edge và Firefox được đăng ký cùng lúc.

### Dùng ID nào

- **Bản Chrome Web Store:** `obbkkjmpgaajcggbhajpdeeadkkchbeo`.
- **Bản chưa đóng gói hoặc build cục bộ:** ID khác, vì Chrome tính ID từ thư mục bạn đã nạp. Bạn xem được ở tab Proxy của tiện ích (mục Companion, "Setup steps") và ở `chrome://extensions` khi bật Chế độ dành cho nhà phát triển, ngay dưới tên tiện ích. Đó là 32 chữ cái từ `a` đến `p`.

Mẹo tránh vấp: ID phải khớp từng ký tự, vì chương trình chỉ trả lời đúng tiện ích mà nó được đăng ký cho. Hồ sơ được lưu riêng theo từng ID tiện ích, nên bản chưa đóng gói và bản từ cửa hàng mỗi bản có hồ sơ riêng. Cài lại với ID khác sẽ tạo thêm một thư mục thứ hai, và phần đăng ký trỏ về thư mục mới nhất.

## Vì sao có `-ExecutionPolicy Bypass`

`Install.ps1` và `Uninstall.ps1` là script văn bản thường và **không** được ký Authenticode. Trên Windows 10/11 thông thường, chính sách mặc định của PowerShell không cho chạy script nào cả, và tệp tải từ internet còn bị gắn dấu "tải từ internet" nữa. Vì thế lệnh ở trên mở PowerShell với `-ExecutionPolicy Bypass`. Tùy chọn này chỉ có tác dụng với đúng tiến trình đó, không đổi chính sách của máy hay của người dùng.

Script ngắn thôi. Hãy đọc `Install.ps1` trước khi chạy, nó được viết để người ta đọc được. Nếu không muốn dùng Bypass, bạn đọc script xong, bỏ chặn các tệp đã giải nén (`Get-ChildItem -Recurse | Unblock-File`) rồi chạy dưới chính sách nào bạn thấy ổn.

## Trình cài đặt làm gì

- Đối chiếu từng tệp với `companion.json`.
- Chép gói vào `%LOCALAPPDATA%\Detect.Expert\ProxyCompanion\<phiên bản>-<gói>-<id>\`.
- Ghi `allowed-callers.json` ở đó: các ID tiện ích được phép nói chuyện với chương trình. Với bất kỳ ai khác, chương trình thoát ngay.
- Đặt các manifest native messaging bên cạnh và đăng ký vào `HKCU\Software\...\NativeMessagingHosts\com.detect_expert.proxy`. Có ID Chrome thì đó là các khóa Google\Chrome, Chromium và Microsoft\Edge; với Firefox là Mozilla.

Nó không xin quyền quản trị, không cài dịch vụ, không đặt tự chạy cùng máy, không thêm driver, không đổi route hệ thống và không đổi cài đặt proxy của trình duyệt. Cài đặt proxy của trình duyệt do tiện ích đổi, và chỉ khi bạn bấm Connect (hoặc bạn đã bật "Connect when the browser starts").

## Cách hoạt động

Trình duyệt khởi chạy `detect-expert-proxy.exe` qua native messaging. Với hồ sơ được bảo vệ, chương trình dựng một relay SOCKS5 cục bộ trên `127.0.0.1` với cổng ngẫu nhiên, và trình duyệt được trỏ vào đó. Từ đây:

- **SOCKS5 có mật khẩu** và **HTTP/HTTPS có tài khoản:** relay tự đăng nhập vào máy chủ của bạn. Proxy HTTP và HTTPS nhận lệnh `CONNECT` kèm xác thực Basic. Chỉ Basic dùng được, và với `http` thường thì tài khoản đi qua mạng dạng văn bản thô, nên nếu được hãy chọn `https` hoặc SOCKS5. Nhiều proxy HTTP chỉ cho `CONNECT` tới cổng 443: nếu cổng 80 bị từ chối bạn sẽ thấy `proxy-denied`.
- **VLESS:** một bản Xray đã ghim phiên bản giữ đường hầm. Hồ sơ được chuyển thành cấu hình Xray từ danh sách trường cho phép. JSON Xray tùy ý và TLS không an toàn đều không được chấp nhận.
- **OpenVPN:** client ở không gian người dùng với network stack riêng. DNS chỉ đi qua đường hầm.

Các engine chạy như tiến trình con trong Windows Job Object, nên chúng tắt cùng chương trình, kể cả khi nó sập. Cấu hình đưa vào engine qua stdin, thông tin đăng nhập qua môi trường riêng, và không có tệp cấu hình dạng văn bản thô nào được tạo ra. Khi đang chạy, engine không tải hay cập nhật gì.

Kill Switch luôn bật: nếu ứng dụng hoặc đường hầm hỏng, các yêu cầu đi qua proxy bị chặn chứ không bị gửi thẳng.

Hồ sơ đã lưu nằm trong một tệp cho mỗi ID tiện ích, ở `%APPDATA%\Detect.Expert\Proxy\`, được Windows DPAPI mã hóa cho người dùng Windows của bạn. Bộ nhớ của chính tiện ích chỉ giữ tên, địa chỉ, cổng và định tuyến, không bao giờ có tài khoản hay mật khẩu.

Ứng dụng này không gửi gì về cho mình. Nó chỉ kết nối tới máy chủ trong hồ sơ của bạn, khi bạn bấm kết nối hoặc chạy kiểm tra.

## Cập nhật

Tải gói mới và chạy lại `Install.ps1` với cùng ID. Hồ sơ của bạn vẫn nằm yên. Gói mới được cài vào thư mục mới, phần đăng ký chuyển sang đó, và thư mục cũ có thể xóa.

## Gỡ cài đặt

Trước hết tắt **Proxy** trong tiện ích. Sau đó chạy trình gỡ từ bản đã cài:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion\<thư mục của bạn>\Uninstall.ps1"
```

Thay `<thư mục của bạn>` bằng tên thư mục mà trình cài đặt đã in ra. (Bạn có thể liệt kê bằng `Get-ChildItem "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"`.)

Lưu ý nhỏ về việc nó xóa gì: **chỉ các khóa registry** của lần cài đó. Tệp chương trình và các hồ sơ đã mã hóa của bạn vẫn còn. Mình cố ý làm vậy để cài lại không làm mất danh sách máy chủ của bạn. Muốn xóa sạch thì tự xóa tay:

```powershell
# tệp chương trình (mọi phiên bản đã cài)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Detect.Expert\ProxyCompanion"

# các hồ sơ đã mã hóa: tài khoản, mật khẩu, liên kết VLESS, cấu hình OpenVPN. Không hoàn tác được.
Remove-Item -Recurse -Force "$env:APPDATA\Detect.Expert\Proxy"
```

Nếu bạn gỡ ứng dụng trong lúc Proxy trong tiện ích vẫn đang bật, lưu lượng đi qua các hồ sơ đó sẽ bị chặn cho đến khi bạn tắt Proxy. Đó là Kill Switch đang làm đúng việc của nó.

## Giới hạn

- Chỉ Windows x64, và chỉ cho lưu lượng của chính trình duyệt. Đây không phải VPN toàn hệ thống.
- Test tự động của mình chạy trên các máy chủ loopback. Mình chưa thử hết các nhà cung cấp OpenVPN hay VLESS thương mại. Nếu hồ sơ của bạn không kết nối được, hãy mở issue và cho mình biết nó thuộc loại nào, đừng kèm thông tin đăng nhập.
- Kiểm tra kết nối là thủ công và chỉ một lần: gửi một yêu cầu qua proxy đã chọn tới một địa chỉ bạn có thể đổi.

## Giấy phép

Dự án, kể cả chương trình host, theo MIT, xem `LICENSE` trong gói. Các engine là chương trình riêng:

- **Xray-core**: MPL-2.0.
- **go-openvpn** (đã vá, tên `openvpn2socks.exe`): AGPL-3.0-or-later.

Mã nguồn đầy đủ của chúng, các bản vá của mình và văn bản giấy phép nằm trong `engines/source/`, kèm `BUILD-SOURCE.md` để build lại. `engines/pins.json` ghi đúng phiên bản và mã kiểm tra.

## Tự build

Cần Windows x64, Node.js 24 hoặc 25 và kho mã này.

```powershell
node scripts/build-proxy-engines.mjs     # tải Go, Xray và mã nguồn go-openvpn đã ghim, kiểm tra SHA-256, build các engine
node scripts/build-proxy-companion.mjs   # vet và test, build detect-expert-proxy.exe, ghi companion.json, đóng gói ZIP
```

Kết quả: `release/proxy-native/windows-amd64/` và `release/Detect.Expert-Proxy-Companion-windows-x64.zip`. Chỉ khi bạn chạy script engine thì mới có tải xuống. Bản tự build không được ký; các tệp phát hành chính thức được ký riêng.
