# WiFi Lab Guardian (English Documentation)

Professional Windows 10 Pro (x64) desktop application built with a lightweight hybrid architecture: a native C# (.NET WinForms) control panel, an offline local Node.js Express & SSE backend, a modern Vanilla JS / CSS frontend, and native Win32 WLAN C++ APIs (`native/wlan_native.cc`). **WiFi Lab Guardian** enables school laboratory teachers and IT administrators to lock classroom PCs onto the authorized laboratory Wi-Fi network, enforce automatic reconnection, and restrict network configuration changes through a Fluent Design GUI — **with zero PowerShell, CMD, or hidden shell script execution**.

## 1. Native Windows 10 Pro Architecture & Validated Win32 APIs

The application utilizes an ultra-lightweight 4-tier stack:
- **GUI Desktop Windows Native (C# .NET WinForms ~43 KB)**: Control shell compiled via `csc.exe`, providing native Windows System Tray integration, background process management without black console windows, and native UAC elevation (`requireAdministrator`).
- **Offline Local Backend (Node.js Express REST & SSE ~4 MB)**: Lightweight local server invoking the compiled C++ N-API addon (`wlan_native.node`) which calls native Windows system libraries (`wlanapi.dll`, `advapi32.dll`, `userenv.dll`, `shell32.dll`).
- **Modern Frontend (HTML5, Modern CSS3, Vanilla JS ~216 KB)**: Responsive interface accessible offline via any local browser or WebView.
- **Standalone Installer (~19 MB)**: Built with **Inno Setup 6** using solid `lzma2/ultra64` compression, bundling standalone `node.exe` v20 for out-of-the-box offline execution on any Windows PC.

All system queries and modifications are performed directly in compiled C++ (`wlan_native.node`) linked against `wlanapi.lib`, `advapi32.lib`, `userenv.lib`, and `shell32.lib` as specified in the Microsoft [Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/) header and [Native Wifi functions](https://learn.microsoft.com/en-us/windows/win32/nativewifi/native-wifi-functions) reference:

| Subsystem | Native Win32 / C++ APIs Used | Technical Implementation |
| :--- | :--- | :--- |
| **WLAN Adapter & Connection Query** | `WlanOpenHandle`, `WlanEnumInterfaces`, `WlanQueryInterface` ([Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/)) | Enumerates wireless interfaces, active SSID, signal quality, and `WlanSvc` operational status. |
| **SSID Allow / Deny Filtering** | [WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist) & [WlanGetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlangetfilterlist) | Populates `wlan_filter_list_type_user_permit` with the lab SSID and sets a wildcard `DOT11_NETWORK` entry (`uSSIDLength = 0`) in `wlan_filter_list_type_user_deny` to block all other infrastructure/ad-hoc networks. |
| **Hide Blocked Networks** | [WlanSetAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetautoconfigparameter) & [WlanQueryAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanqueryautoconfigparameter) | Sets `wlan_autoconf_opcode_show_denied_networks` to `FALSE` so blocked networks are omitted from the Windows available network list. |
| **Auto-Connect & Preferred Order** | `WlanGetProfile`, `WlanSetProfile`, `WlanSetProfilePosition`, [WlanConnect](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanconnect) | Ensures `<connectionMode>auto</connectionMode>` in the profile XML, moves the profile to index `0`, and initiates association. |
| **Per-User Profile DACL Lock** | [WlanSetSecuritySettings](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetsecuritysettings) & [WlanGetSecuritySettings](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlangetsecuritysettings) | Applies a restrictive SDDL on the [WLAN_SECURABLE_OBJECT](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ne-wlanapi-wlan_securable_object) `wlan_secure_add_new_per_user_profiles` so standard users cannot create unauthorized per-user profiles. |
| **Radio & Airplane Mode Inspection** | [WlanSetInterface](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetinterface), [WLAN_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_radio_state), [WLAN_PHY_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_phy_radio_state) | Reads software (`dot11SoftwareRadioState`) and hardware (`dot11HardwareRadioState`) PHY states alongside `SystemRadioState`, automatically restoring software radio state when toggled off. |
| **Event-Driven Monitoring** | `WlanRegisterNotification` ([Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/)) | Streams `WLAN_NOTIFICATION_SOURCE_ACM` and `WLAN_NOTIFICATION_SOURCE_MSM` notifications into Electron via `Napi::ThreadSafeFunction`. |
| **Windows 10 Policies** | `RegCreateKeyExW`, `RegSetValueExW`, `RefreshPolicyEx`, [IGroupPolicyObject](https://learn.microsoft.com/en-us/windows/win32/api/gpedit/nn-gpedit-igrouppolicyobject) | Manages [SettingsPageVisibility](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-settings) (`hide:network-wifi;network-airplanemode;...`) and `NoNetSetup`. |

## 2. Security Model & Technical Honesty

- **Service-Enforced Restrictions vs. UI Hiding**: The GUI and documentation explicitly separate service-enforced WLAN filters ([WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist), [WlanSetAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetautoconfigparameter), and [WlanSetSecuritySettings](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetsecuritysettings)) from UI-hiding policies ([SettingsPageVisibility](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-settings)).
- **Disconnection Behavior**: Blocking other SSIDs via [WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist) prevents connecting to unauthorized networks, but does not prevent a user from disconnecting from the currently connected network. The `MonitoringService` listens for `wlan_notification_acm_disconnected` and automatically calls [WlanConnect](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanconnect) only while protection is enabled.
- **Airplane Mode Limitation on Windows 10 Pro**: As documented in [WLAN_PHY_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_phy_radio_state), `dot11HardwareRadioState` cannot be modified via [WlanSetInterface](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetinterface), and Windows 10 Pro does not offer a supported API that permanently disables Airplane Mode across all hardware switches and quick toggles. The GUI clearly reports this limitation and displays real-time radio/airplane mode diagnostics.
- **Shared Account & UAC Elevation**: Because teachers and students share the same Windows login, user-scoped Group Policy cannot separate them. System modifications require Windows UAC Administrator privileges (`TokenElevation` check + `ShellExecuteExW` with `runas`). No fake password prompt is used, and Wi-Fi passwords (`<keyMaterial>`) are strictly redacted from logs and config files.

## 3. Standalone Installer Packaging (~19 MB)

The final deliverable is generated via **Inno Setup 6** with solid `lzma2/ultra64` compression (`WiFi-Lab-Guardian-Setup-1.0.0.exe`):
- **Ultra-Reduced Size (~19 MB)**: By eliminating the Chromium engine (~70 MB) in favor of the native C# WinForms shell (~43 KB) and compressed Node.js runtime, installer size and RAM usage are drastically minimized.
- **100% Standalone & Offline**: The installer packages `bin\node.exe` (v20 x64) and the compiled C++ addon `wlan_native.node`. It runs immediately on any Windows 10/11 target machine without requiring Node.js, Python, or an internet connection.
- **Persistence & Safe Storage**: Persistent configuration (`config.v2.json`), backups (`backups/`), and redacted diagnostic logs (`logs/guardian.log`) are stored in `%APPDATA%\WiFiLabGuardian`.

## 4. Building Locally or via GitHub Actions

Push to GitHub or trigger `.github/workflows/build.yml` on `windows-2022` to compile `wlan_native.node` with `node-gyp`, compile `WiFiLabGuardian.exe` via `csc.exe`, and generate the standalone Inno Setup installer artifact:

```cmd
npm install --ignore-scripts
npx node-gyp rebuild --arch=x64
node tests/verify-services.js
powershell -ExecutionPolicy Bypass -File .\build-gui.ps1
iscc installer.iss
```
