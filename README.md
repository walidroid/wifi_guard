# WiFi Lab Guardian (English Documentation)

A **100% portable, standalone Windows desktop application (~40 KB)** designed for teachers and school laboratory administrators. **WiFi Lab Guardian** operates without installation, without local servers, and with zero external dependencies.

---

## 🚀 Focused Key Features

The application is completely streamlined to focus strictly on the two essential classroom requirements:
1. **Enable / Disable Wi-Fi Protection**: Locks network access exclusively to the authorized classroom Wi-Fi and blocks/hides all other SSIDs via Win32 Native WLAN APIs (`wlanapi.dll`).
2. **Hide & Neutralize Airplane Mode**:
   - Removes the Airplane Mode quick action tile from the taskbar network flyout (`ActionCenter\Quick Actions\All`).
   - Stops and disables the Windows Radio Management Service (`RmSvc`) to prevent radio shutdown via Fn hotkeys or software toggles.
   - Hides the Airplane Mode page in Windows 10/11 Settings (`SettingsPageVisibility`).
   - Allows restarting Windows Explorer in 1 click to apply taskbar flyout changes immediately without rebooting.

---

## 🛠️ 100% Native & Portable Architecture

* **Single Executable (~40 KB)**: `WiFiLabGuardian.exe` requires no installation and runs directly from a USB stick or network share.
* **Zero Server / Zero Dependencies**: No Node.js, no Electron, no browser runtime, no background daemons.
* **Instant Startup (< 0.1 s)** and ultra-low memory usage (< 15 MB RAM).
* **Direct Win32 & Group Policy APIs**:
  - `wlanapi.dll`: `WlanOpenHandle`, `WlanEnumInterfaces`, `WlanQueryInterface`, `WlanSetFilterList`, `WlanSetAutoConfigParameter`, `WlanSetSecuritySettings`.
  - `userenv.dll`: `RefreshPolicyEx` (instant Group Policy refresh).
  - Windows Registry: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\SettingsPageVisibility`.

---

## 🔨 Build

Run in PowerShell:
```powershell
.\build-gui.ps1
```
or double-click `build.bat`. The portable binary `WiFiLabGuardian.exe` is compiled immediately using Windows built-in C# compiler (`csc.exe`).
