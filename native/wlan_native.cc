// =============================================================================
// WiFi Lab Guardian - Native Windows C++ N-API Addon (native/wlan_native.cc)
// =============================================================================
// Target Platform: Windows 10 Pro x64 (_WIN32_WINNT >= 0x0A00)
// Zero shell spawning (NO cmd.exe, NO powershell.exe, NO netsh.exe).
// Uses official Microsoft Win32 APIs directly:
//   - Native Wifi API (wlanapi.h / wlanapi.lib):
//       WlanOpenHandle, WlanCloseHandle, WlanEnumInterfaces,
//       WlanQueryInterface, WlanSetInterface, WlanGetAvailableNetworkList,
//       WlanGetProfileList, WlanGetProfile, WlanSetProfile,
//       WlanSetProfilePosition, WlanDeleteProfile, WlanGetFilterList,
//       WlanSetFilterList, WlanQueryAutoConfigParameter,
//       WlanSetAutoConfigParameter (wlan_autoconf_opcode_show_denied_networks),
//       WlanGetSecuritySettings, WlanSetSecuritySettings,
//       WlanConnect, WlanDisconnect, WlanScan,
//       WlanRegisterNotification, WlanReasonCodeToString, WlanFreeMemory
//   - Windows Security & UAC API (securitybaseapi.h / shellapi.h):
//       OpenProcessToken, GetTokenInformation (TokenElevation),
//       ShellExecuteExW (L"runas" verb for UAC elevation)
//   - Windows Registry & Group Policy API (winreg.h / userenv.h):
//       RegOpenKeyExW, RegCreateKeyExW, RegQueryValueExW, RegSetValueExW,
//       RegDeleteValueW, RegCloseKey, RefreshPolicyEx
//   - Configuration Manager / PnP Device Status API (cfgmgr32.h):
//       CM_Locate_DevNodeW, CM_Get_DevNode_Status
// =============================================================================

#include <napi.h>

#ifdef _WIN32
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <wlanapi.h>
#include <windot11.h>
#include <objbase.h>
#include <netlistmgr.h>
#include <shellapi.h>
#include <userenv.h>
#include <cfgmgr32.h>
#include <sddl.h>
#include <iphlpapi.h>

#include <string>
#include <vector>
#include <mutex>
#include <atomic>

#pragma comment(lib, "wlanapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "userenv.lib")
#pragma comment(lib, "cfgmgr32.lib")
#pragma comment(lib, "iphlpapi.lib")

namespace {

std::string WideToUtf8(const std::wstring& wstr) {
  if (wstr.empty()) return std::string();
  int size_needed = WideCharToMultiByte(
      CP_UTF8, 0, wstr.data(), static_cast<int>(wstr.size()),
      nullptr, 0, nullptr, nullptr);
  if (size_needed <= 0) return std::string();
  std::string result(size_needed, 0);
  WideCharToMultiByte(
      CP_UTF8, 0, wstr.data(), static_cast<int>(wstr.size()),
      &result[0], size_needed, nullptr, nullptr);
  return result;
}

std::wstring Utf8ToWide(const std::string& str) {
  if (str.empty()) return std::wstring();
  int size_needed = MultiByteToWideChar(
      CP_UTF8, 0, str.data(), static_cast<int>(str.size()), nullptr, 0);
  if (size_needed <= 0) return std::wstring();
  std::wstring result(size_needed, 0);
  MultiByteToWideChar(
      CP_UTF8, 0, str.data(), static_cast<int>(str.size()),
      &result[0], size_needed);
  return result;
}

std::string GuidToString(const GUID& guid) {
  wchar_t buf[64] = {0};
  int len = StringFromGUID2(guid, buf, 64);
  if (len <= 0) return "";
  return WideToUtf8(std::wstring(buf));
}

bool StringToGuid(const std::string& str, GUID* out_guid) {
  std::wstring wstr = Utf8ToWide(str);
  if (wstr.empty()) return false;
  if (wstr.front() != L'{') {
    wstr = L"{" + wstr + L"}";
  }
  HRESULT hr = CLSIDFromString(wstr.c_str(), out_guid);
  return SUCCEEDED(hr);
}

std::string SsidToString(const DOT11_SSID& ssid) {
  if (ssid.uSSIDLength == 0 || ssid.uSSIDLength > DOT11_SSID_MAX_LENGTH) {
    return "";
  }
  return std::string(
      reinterpret_cast<const char*>(ssid.ucSSID),
      static_cast<size_t>(ssid.uSSIDLength));
}

DOT11_SSID StringToSsid(const std::string& ssid_str) {
  DOT11_SSID ssid = {};
  size_t len = ssid_str.size();
  if (len > DOT11_SSID_MAX_LENGTH) {
    len = DOT11_SSID_MAX_LENGTH;
  }
  ssid.uSSIDLength = static_cast<ULONG>(len);
  memcpy(ssid.ucSSID, ssid_str.data(), len);
  return ssid;
}

std::string Win32ErrorToString(DWORD error_code) {
  wchar_t* msg_buf = nullptr;
  DWORD size = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, error_code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<LPWSTR>(&msg_buf), 0, nullptr);
  std::string message;
  if (size > 0 && msg_buf != nullptr) {
    std::wstring wmsg(msg_buf, size);
    while (!wmsg.empty() && (wmsg.back() == L'\r' || wmsg.back() == L'\n')) {
      wmsg.pop_back();
    }
    message = WideToUtf8(wmsg);
    LocalFree(msg_buf);
  } else {
    message = "Win32 error code " + std::to_string(error_code);
  }
  return message;
}

class ScopedWlanHandle {
 public:
  ScopedWlanHandle() : handle_(nullptr), negotiated_version_(0), status_(0) {
    status_ = WlanOpenHandle(2, nullptr, &negotiated_version_, &handle_);
  }
  ~ScopedWlanHandle() {
    if (handle_ != nullptr) {
      WlanCloseHandle(handle_, nullptr);
      handle_ = nullptr;
    }
  }
  bool IsValid() const { return status_ == ERROR_SUCCESS && handle_ != nullptr; }
  HANDLE get() const { return handle_; }
  DWORD status() const { return status_; }

 private:
  HANDLE handle_;
  DWORD negotiated_version_;
  DWORD status_;
};

std::string InterfaceStateToString(WLAN_INTERFACE_STATE state) {
  switch (state) {
    case wlan_interface_state_not_ready: return "not_ready";
    case wlan_interface_state_connected: return "connected";
    case wlan_interface_state_ad_hoc_network_formed: return "ad_hoc_network_formed";
    case wlan_interface_state_disconnecting: return "disconnecting";
    case wlan_interface_state_disconnected: return "disconnected";
    case wlan_interface_state_associating: return "associating";
    case wlan_interface_state_discovering: return "discovering";
    case wlan_interface_state_authenticating: return "authenticating";
    default: return "unknown";
  }
}

std::string RadioStateToString(DOT11_RADIO_STATE state) {
  switch (state) {
    case dot11_radio_state_on: return "on";
    case dot11_radio_state_off: return "off";
    case dot11_radio_state_unknown:
    default:
      return "unknown";
  }
}

struct WlanEventPayload {
  std::string source;
  std::string codeName;
  uint32_t code;
  std::string interfaceGuid;
  std::string ssid;
  std::string profileName;
  std::string reasonMessage;
  uint32_t reasonCode;
  std::string softwareRadioState;
  std::string hardwareRadioState;
};

std::mutex g_notif_mutex;
HANDLE g_notif_wlan_handle = nullptr;
Napi::ThreadSafeFunction g_notif_tsfn;
std::atomic<bool> g_notif_active{false};

void WINAPI OnWlanNotificationCallback(PWLAN_NOTIFICATION_DATA data, PVOID /*context*/) {
  if (!g_notif_active.load() || data == nullptr) {
    return;
  }

  auto* payload = new WlanEventPayload();
  payload->code = data->NotificationCode;
  payload->interfaceGuid = GuidToString(data->InterfaceGuid);
  payload->reasonCode = 0;

  if (data->NotificationSource == WLAN_NOTIFICATION_SOURCE_ACM) {
    payload->source = "ACM";
    switch (data->NotificationCode) {
      case wlan_notification_acm_autoconf_enabled:
        payload->codeName = "autoconf_enabled";
        break;
      case wlan_notification_acm_autoconf_disabled:
        payload->codeName = "autoconf_disabled";
        break;
      case wlan_notification_acm_interface_arrival:
        payload->codeName = "interface_arrival";
        break;
      case wlan_notification_acm_interface_removal:
        payload->codeName = "interface_removal";
        break;
      case wlan_notification_acm_profile_change:
        payload->codeName = "profile_change";
        break;
      case wlan_notification_acm_profile_name_change:
        payload->codeName = "profile_name_change";
        break;
      case wlan_notification_acm_profiles_exhausted:
        payload->codeName = "profiles_exhausted";
        break;
      case wlan_notification_acm_network_not_available:
        payload->codeName = "network_not_available";
        break;
      case wlan_notification_acm_network_available:
        payload->codeName = "network_available";
        break;
      case wlan_notification_acm_disconnecting:
        payload->codeName = "disconnecting";
        break;
      case wlan_notification_acm_disconnected:
        payload->codeName = "disconnected";
        break;
      case wlan_notification_acm_connection_start:
        payload->codeName = "connection_start";
        break;
      case wlan_notification_acm_connection_complete:
        payload->codeName = "connection_complete";
        break;
      case wlan_notification_acm_connection_attempt_fail:
        payload->codeName = "connection_attempt_fail";
        break;
      case wlan_notification_acm_filter_list_change:
        payload->codeName = "filter_list_change";
        break;
      default:
        payload->codeName = "acm_event_" + std::to_string(data->NotificationCode);
        break;
    }

    if (data->pData != nullptr &&
        data->dwDataSize >= sizeof(WLAN_CONNECTION_NOTIFICATION_DATA) &&
        (data->NotificationCode == wlan_notification_acm_connection_start ||
         data->NotificationCode == wlan_notification_acm_connection_complete ||
         data->NotificationCode == wlan_notification_acm_connection_attempt_fail ||
         data->NotificationCode == wlan_notification_acm_disconnecting ||
         data->NotificationCode == wlan_notification_acm_disconnected)) {
      const auto* conn_data =
          reinterpret_cast<const WLAN_CONNECTION_NOTIFICATION_DATA*>(data->pData);
      payload->profileName = WideToUtf8(conn_data->strProfileName);
      payload->ssid = SsidToString(conn_data->dot11Ssid);
      payload->reasonCode = conn_data->wlanReasonCode;
      if (conn_data->wlanReasonCode != WLAN_REASON_CODE_SUCCESS) {
        wchar_t reason_buf[512] = {0};
        if (WlanReasonCodeToString(
                conn_data->wlanReasonCode, 512, reason_buf, nullptr) == ERROR_SUCCESS) {
          payload->reasonMessage = WideToUtf8(reason_buf);
        }
      }
    }
  } else if (data->NotificationSource == WLAN_NOTIFICATION_SOURCE_MSM) {
    payload->source = "MSM";
    switch (data->NotificationCode) {
      case wlan_notification_msm_associating:
        payload->codeName = "msm_associating";
        break;
      case wlan_notification_msm_associated:
        payload->codeName = "msm_associated";
        break;
      case wlan_notification_msm_authenticating:
        payload->codeName = "msm_authenticating";
        break;
      case wlan_notification_msm_connected:
        payload->codeName = "msm_connected";
        break;
      case wlan_notification_msm_disassociating:
        payload->codeName = "msm_disassociating";
        break;
      case wlan_notification_msm_disconnected:
        payload->codeName = "msm_disconnected";
        break;
      case wlan_notification_msm_radio_state_change:
        payload->codeName = "radio_state_change";
        if (data->pData != nullptr &&
            data->dwDataSize >= sizeof(WLAN_PHY_RADIO_STATE)) {
          const auto* radio =
              reinterpret_cast<const WLAN_PHY_RADIO_STATE*>(data->pData);
          payload->softwareRadioState =
              RadioStateToString(radio->dot11SoftwareRadioState);
          payload->hardwareRadioState =
              RadioStateToString(radio->dot11HardwareRadioState);
        }
        break;
      default:
        payload->codeName = "msm_event_" + std::to_string(data->NotificationCode);
        break;
    }
  } else {
    payload->source = "OTHER";
    payload->codeName = "event_" + std::to_string(data->NotificationCode);
  }

  napi_status status = g_notif_tsfn.NonBlockingCall(
      payload, [](Napi::Env env, Napi::Function js_callback, WlanEventPayload* item) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("source", item->source);
        obj.Set("codeName", item->codeName);
        obj.Set("code", Napi::Number::New(env, item->code));
        obj.Set("interfaceGuid", item->interfaceGuid);
        obj.Set("ssid", item->ssid);
        obj.Set("profileName", item->profileName);
        obj.Set("reasonCode", Napi::Number::New(env, item->reasonCode));
        obj.Set("reasonMessage", item->reasonMessage);
        if (!item->softwareRadioState.empty()) {
          obj.Set("softwareRadioState", item->softwareRadioState);
          obj.Set("hardwareRadioState", item->hardwareRadioState);
        }
        js_callback.Call({obj});
        delete item;
      });

  if (status != napi_ok) {
    delete payload;
  }
}

bool ReadRegistryDword(HKEY root, const wchar_t* subkey, const wchar_t* value_name, DWORD* out_val) {
  HKEY hKey = nullptr;
  if (RegOpenKeyExW(root, subkey, 0, KEY_READ | KEY_WOW64_64KEY, &hKey) != ERROR_SUCCESS) {
    return false;
  }
  DWORD data = 0;
  DWORD data_size = sizeof(DWORD);
  DWORD type = 0;
  LONG res = RegQueryValueExW(
      hKey, value_name, nullptr, &type, reinterpret_cast<LPBYTE>(&data), &data_size);
  RegCloseKey(hKey);
  if (res == ERROR_SUCCESS && (type == REG_DWORD || type == REG_BINARY)) {
    *out_val = data;
    return true;
  }
  return false;
}

bool ReadRegistryString(HKEY root, const wchar_t* subkey, const wchar_t* value_name, std::string* out_val) {
  HKEY hKey = nullptr;
  if (RegOpenKeyExW(root, subkey, 0, KEY_READ | KEY_WOW64_64KEY, &hKey) != ERROR_SUCCESS) {
    return false;
  }
  DWORD data_size = 0;
  DWORD type = 0;
  LONG res = RegQueryValueExW(hKey, value_name, nullptr, &type, nullptr, &data_size);
  if (res != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ) || data_size == 0) {
    RegCloseKey(hKey);
    return false;
  }
  std::vector<wchar_t> buf((data_size / sizeof(wchar_t)) + 1, 0);
  res = RegQueryValueExW(
      hKey, value_name, nullptr, &type, reinterpret_cast<LPBYTE>(buf.data()), &data_size);
  RegCloseKey(hKey);
  if (res != ERROR_SUCCESS) return false;
  *out_val = WideToUtf8(std::wstring(buf.data()));
  return true;
}

}  // namespace

// =============================================================================
// 1. Check Administrator Elevation (OpenProcessToken + TokenElevation)
// =============================================================================
Napi::Value IsProcessElevated(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  BOOL is_elevated = FALSE;
  HANDLE token = nullptr;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    TOKEN_ELEVATION elevation = {};
    DWORD size = sizeof(TOKEN_ELEVATION);
    if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size)) {
      is_elevated = elevation.TokenIsElevated;
    }
    CloseHandle(token);
  }
  return Napi::Boolean::New(env, is_elevated != FALSE);
}

// =============================================================================
// 2. Request UAC Relaunch (ShellExecuteExW with "runas" verb)
// =============================================================================
Napi::Value RequestUacElevation(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  wchar_t exe_path[MAX_PATH * 2] = {0};
  if (GetModuleFileNameW(nullptr, exe_path, MAX_PATH * 2) == 0) {
    result.Set("success", false);
    result.Set("errorCode", static_cast<uint32_t>(GetLastError()));
    result.Set("errorMessage", Win32ErrorToString(GetLastError()));
    return result;
  }

  std::wstring params = L"";
  if (info.Length() > 0 && info[0].IsString()) {
    params = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  }

  SHELLEXECUTEINFOW sei = {};
  sei.cbSize = sizeof(SHELLEXECUTEINFOW);
  sei.fMask = SEE_MASK_NOCLOSEPROCESS;
  sei.lpVerb = L"runas";
  sei.lpFile = exe_path;
  sei.lpParameters = params.empty() ? nullptr : params.c_str();
  sei.nShow = SW_SHOWNORMAL;

  if (!ShellExecuteExW(&sei)) {
    DWORD err = GetLastError();
    result.Set("success", false);
    result.Set("cancelledByUser", err == ERROR_CANCELLED);
    result.Set("errorCode", static_cast<uint32_t>(err));
    result.Set("errorMessage", Win32ErrorToString(err));
    return result;
  }

  if (sei.hProcess != nullptr) {
    CloseHandle(sei.hProcess);
  }
  result.Set("success", true);
  result.Set("cancelledByUser", false);
  return result;
}

// =============================================================================
// 3. Get Comprehensive WLAN & Airplane Mode Status
// =============================================================================
Napi::Value GetWlanStatus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object status = Napi::Object::New(env);

  // Check Airplane Mode Radio Management registry indicator on Windows 10
  // HKLM\SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState
  DWORD airplane_dword = 0;
  bool airplane_known = ReadRegistryDword(
      HKEY_LOCAL_MACHINE,
      L"SYSTEM\\CurrentControlSet\\Control\\RadioManagement\\SystemRadioState",
      L"",
      &airplane_dword);
  status.Set("airplaneModeKnown", airplane_known);
  status.Set("airplaneModeEnabled", airplane_known ? (airplane_dword == 1) : false);

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    status.Set("wlanServiceRunning", false);
    status.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    status.Set("errorMessage", Win32ErrorToString(wlan.status()));
    status.Set("interfaces", Napi::Array::New(env, 0));
    return status;
  }

  status.Set("wlanServiceRunning", true);

  // Query WlanQueryAutoConfigParameter for wlan_autoconf_opcode_show_denied_networks
  BOOL* show_denied_ptr = nullptr;
  DWORD show_denied_size = 0;
  if (WlanQueryAutoConfigParameter(
          wlan.get(), wlan_autoconf_opcode_show_denied_networks, nullptr,
          &show_denied_size, reinterpret_cast<PVOID*>(&show_denied_ptr),
          nullptr) == ERROR_SUCCESS &&
      show_denied_ptr != nullptr) {
    status.Set("showDeniedNetworks", *show_denied_ptr != FALSE);
    WlanFreeMemory(show_denied_ptr);
  } else {
    status.Set("showDeniedNetworks", false);
  }

  PWLAN_INTERFACE_INFO_LIST iface_list = nullptr;
  DWORD enum_res = WlanEnumInterfaces(wlan.get(), nullptr, &iface_list);
  if (enum_res != ERROR_SUCCESS || iface_list == nullptr) {
    status.Set("errorCode", static_cast<uint32_t>(enum_res));
    status.Set("errorMessage", Win32ErrorToString(enum_res));
    status.Set("interfaces", Napi::Array::New(env, 0));
    return status;
  }

  Napi::Array interfaces_arr = Napi::Array::New(env, iface_list->dwNumberOfItems);

  for (DWORD i = 0; i < iface_list->dwNumberOfItems; ++i) {
    const WLAN_INTERFACE_INFO& item = iface_list->InterfaceInfo[i];
    Napi::Object iface_obj = Napi::Object::New(env);

    iface_obj.Set("guid", GuidToString(item.InterfaceGuid));
    iface_obj.Set("description", WideToUtf8(item.strInterfaceDescription));
    iface_obj.Set("state", InterfaceStateToString(item.isState));
    iface_obj.Set("connected", item.isState == wlan_interface_state_connected);

    DWORD data_size = 0;
    BOOL* autoconf_ptr = nullptr;
    if (WlanQueryInterface(
            wlan.get(), &item.InterfaceGuid, wlan_intf_opcode_autoconf_enabled,
            nullptr, &data_size, reinterpret_cast<PVOID*>(&autoconf_ptr),
            nullptr) == ERROR_SUCCESS &&
        autoconf_ptr != nullptr) {
      iface_obj.Set("autoconfEnabled", *autoconf_ptr != FALSE);
      WlanFreeMemory(autoconf_ptr);
    } else {
      iface_obj.Set("autoconfEnabled", true);
    }

    PWLAN_RADIO_STATE radio_state = nullptr;
    DWORD radio_size = 0;
    if (WlanQueryInterface(
            wlan.get(), &item.InterfaceGuid, wlan_intf_opcode_radio_state,
            nullptr, &radio_size, reinterpret_cast<PVOID*>(&radio_state),
            nullptr) == ERROR_SUCCESS &&
        radio_state != nullptr && radio_state->dwNumberOfPhys > 0) {
      const WLAN_PHY_RADIO_STATE& phy = radio_state->PhyRadioState[0];
      iface_obj.Set("softwareRadioState", RadioStateToString(phy.dot11SoftwareRadioState));
      iface_obj.Set("hardwareRadioState", RadioStateToString(phy.dot11HardwareRadioState));
      bool radio_on = (phy.dot11SoftwareRadioState == dot11_radio_state_on) &&
                      (phy.dot11HardwareRadioState == dot11_radio_state_on);
      iface_obj.Set("radioEnabled", radio_on);
      WlanFreeMemory(radio_state);
    } else {
      iface_obj.Set("softwareRadioState", "unknown");
      iface_obj.Set("hardwareRadioState", "unknown");
      iface_obj.Set("radioEnabled", true);
    }

    if (item.isState == wlan_interface_state_connected) {
      PWLAN_CONNECTION_ATTRIBUTES conn_attr = nullptr;
      DWORD conn_size = 0;
      if (WlanQueryInterface(
              wlan.get(), &item.InterfaceGuid, wlan_intf_opcode_current_connection,
              nullptr, &conn_size, reinterpret_cast<PVOID*>(&conn_attr),
              nullptr) == ERROR_SUCCESS &&
          conn_attr != nullptr) {
        iface_obj.Set("connectedProfileName", WideToUtf8(conn_attr->strProfileName));
        iface_obj.Set(
            "connectedSsid",
            SsidToString(conn_attr->wlanAssociationAttributes.dot11Ssid));
        iface_obj.Set(
            "signalQuality",
            static_cast<uint32_t>(
                conn_attr->wlanAssociationAttributes.wlanSignalQuality));
        iface_obj.Set(
            "securityEnabled",
            conn_attr->wlanSecurityAttributes.bSecurityEnabled != FALSE);
        WlanFreeMemory(conn_attr);
      }
    } else {
      iface_obj.Set("connectedProfileName", "");
      iface_obj.Set("connectedSsid", "");
      iface_obj.Set("signalQuality", 0);
    }

    interfaces_arr.Set(i, iface_obj);
  }

  WlanFreeMemory(iface_list);
  status.Set("interfaces", interfaces_arr);
  return status;
}

// =============================================================================
// 4. Enumerate Available Visible & Profile Networks on Interface
// =============================================================================
Napi::Value GetAvailableNetworks(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    return Napi::Array::New(env, 0);
  }

  PWLAN_INTERFACE_INFO_LIST iface_list = nullptr;
  if (WlanEnumInterfaces(wlan.get(), nullptr, &iface_list) != ERROR_SUCCESS ||
      iface_list == nullptr || iface_list->dwNumberOfItems == 0) {
    if (iface_list) WlanFreeMemory(iface_list);
    return Napi::Array::New(env, 0);
  }

  GUID target_guid = iface_list->InterfaceInfo[0].InterfaceGuid;
  if (info.Length() > 0 && info[0].IsString()) {
    StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid);
  }
  WlanFreeMemory(iface_list);

  PWLAN_AVAILABLE_NETWORK_LIST net_list = nullptr;
  DWORD res = WlanGetAvailableNetworkList(
      wlan.get(), &target_guid,
      WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_ADHOC_PROFILES |
          WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_MANUAL_HIDDEN_PROFILES,
      nullptr, &net_list);
  if (res != ERROR_SUCCESS || net_list == nullptr) {
    return Napi::Array::New(env, 0);
  }

  Napi::Array arr = Napi::Array::New(env);
  uint32_t out_idx = 0;
  for (DWORD i = 0; i < net_list->dwNumberOfItems; ++i) {
    const WLAN_AVAILABLE_NETWORK& net = net_list->Network[i];
    std::string ssid = SsidToString(net.dot11Ssid);
    if (ssid.empty()) continue;

    Napi::Object net_obj = Napi::Object::New(env);
    net_obj.Set("ssid", ssid);
    net_obj.Set("profileName", WideToUtf8(net.strProfileName));
    net_obj.Set("signalQuality", static_cast<uint32_t>(net.wlanSignalQuality));
    net_obj.Set("securityEnabled", net.bSecurityEnabled != FALSE);
    net_obj.Set("connectable", net.bNetworkConnectable != FALSE);
    net_obj.Set("connected", (net.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED) != 0);
    net_obj.Set("hasProfile", (net.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE) != 0);
    arr.Set(out_idx++, net_obj);
  }

  WlanFreeMemory(net_list);
  return arr;
}

// =============================================================================
// 5. Get Saved WLAN Profiles (with XML export for Backup/Restore)
// =============================================================================
Napi::Value GetProfiles(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    return Napi::Array::New(env, 0);
  }

  PWLAN_INTERFACE_INFO_LIST iface_list = nullptr;
  if (WlanEnumInterfaces(wlan.get(), nullptr, &iface_list) != ERROR_SUCCESS ||
      iface_list == nullptr || iface_list->dwNumberOfItems == 0) {
    if (iface_list) WlanFreeMemory(iface_list);
    return Napi::Array::New(env, 0);
  }

  GUID target_guid = iface_list->InterfaceInfo[0].InterfaceGuid;
  if (info.Length() > 0 && info[0].IsString()) {
    StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid);
  }
  WlanFreeMemory(iface_list);

  PWLAN_PROFILE_INFO_LIST prof_list = nullptr;
  if (WlanGetProfileList(wlan.get(), &target_guid, nullptr, &prof_list) != ERROR_SUCCESS ||
      prof_list == nullptr) {
    return Napi::Array::New(env, 0);
  }

  Napi::Array result = Napi::Array::New(env, prof_list->dwNumberOfItems);
  for (DWORD i = 0; i < prof_list->dwNumberOfItems; ++i) {
    const WLAN_PROFILE_INFO& pinfo = prof_list->ProfileInfo[i];
    Napi::Object pobj = Napi::Object::New(env);
    pobj.Set("name", WideToUtf8(pinfo.strProfileName));
    pobj.Set("flags", static_cast<uint32_t>(pinfo.dwFlags));

    LPWSTR xml_str = nullptr;
    DWORD profile_flags = 0;
    DWORD granted_access = 0;
    if (WlanGetProfile(
            wlan.get(), &target_guid, pinfo.strProfileName, nullptr, &xml_str,
            &profile_flags, &granted_access) == ERROR_SUCCESS &&
        xml_str != nullptr) {
      std::string xml_utf8 = WideToUtf8(xml_str);
      pobj.Set("xml", xml_utf8);
      pobj.Set(
          "autoConnect",
          xml_utf8.find("<connectionMode>auto</connectionMode>") != std::string::npos);
      WlanFreeMemory(xml_str);
    } else {
      pobj.Set("xml", "");
      pobj.Set("autoConnect", false);
    }
    result.Set(i, pobj);
  }

  WlanFreeMemory(prof_list);
  return result;
}

// =============================================================================
// 6. Set or Update a WLAN Profile XML (WlanSetProfile)
// =============================================================================
Napi::Value SetProfileXml(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res_obj = Napi::Object::New(env);

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    res_obj.Set("success", false);
    res_obj.Set("errorMessage", "Missing interfaceGuid or profileXml");
    return res_obj;
  }

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    res_obj.Set("success", false);
    res_obj.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    res_obj.Set("errorMessage", Win32ErrorToString(wlan.status()));
    return res_obj;
  }

  GUID target_guid = {};
  if (!StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid)) {
    res_obj.Set("success", false);
    res_obj.Set("errorMessage", "Invalid interface GUID");
    return res_obj;
  }

  std::wstring xml_wide = Utf8ToWide(info[1].As<Napi::String>().Utf8Value());
  DWORD reason_code = 0;
  DWORD set_res = WlanSetProfile(
      wlan.get(), &target_guid, 0, xml_wide.c_str(), nullptr, TRUE, nullptr,
      &reason_code);

  if (set_res != ERROR_SUCCESS) {
    wchar_t reason_buf[512] = {0};
    WlanReasonCodeToString(reason_code, 512, reason_buf, nullptr);
    res_obj.Set("success", false);
    res_obj.Set("errorCode", static_cast<uint32_t>(set_res));
    res_obj.Set("reasonCode", static_cast<uint32_t>(reason_code));
    res_obj.Set("errorMessage", Win32ErrorToString(set_res) + " (" + WideToUtf8(reason_buf) + ")");
    return res_obj;
  }

  res_obj.Set("success", true);
  return res_obj;
}

// =============================================================================
// 7. Prioritize a Profile at the Top of the Preferred List (WlanSetProfilePosition)
// =============================================================================
Napi::Value SetPreferredProfilePosition(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res_obj = Napi::Object::New(env);

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    res_obj.Set("success", false);
    res_obj.Set("errorMessage", "Missing interfaceGuid or profileName");
    return res_obj;
  }

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    res_obj.Set("success", false);
    res_obj.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    res_obj.Set("errorMessage", Win32ErrorToString(wlan.status()));
    return res_obj;
  }

  GUID target_guid = {};
  StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid);
  std::wstring prof_name = Utf8ToWide(info[1].As<Napi::String>().Utf8Value());
  DWORD pos = 0;
  if (info.Length() >= 3 && info[2].IsNumber()) {
    pos = info[2].As<Napi::Number>().Uint32Value();
  }

  DWORD status = WlanSetProfilePosition(
      wlan.get(), &target_guid, prof_name.c_str(), pos, nullptr);
  res_obj.Set("success", status == ERROR_SUCCESS);
  res_obj.Set("errorCode", static_cast<uint32_t>(status));
  if (status != ERROR_SUCCESS) {
    res_obj.Set("errorMessage", Win32ErrorToString(status));
  }
  return res_obj;
}

// =============================================================================
// 8. Get Current WLAN Permit & Deny Filter Lists + ShowDeniedNetworks state
// =============================================================================
Napi::Value GetFilterLists(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    out.Set("allowList", Napi::Array::New(env, 0));
    out.Set("denyList", Napi::Array::New(env, 0));
    out.Set("showDeniedNetworks", false);
    return out;
  }

  auto read_list = [&](WLAN_FILTER_LIST_TYPE list_type) -> Napi::Array {
    PDOT11_NETWORK_LIST net_list = nullptr;
    Napi::Array arr = Napi::Array::New(env);
    if (WlanGetFilterList(wlan.get(), list_type, nullptr, &net_list) == ERROR_SUCCESS &&
        net_list != nullptr) {
      for (DWORD i = 0; i < net_list->dwNumberOfItems; ++i) {
        Napi::Object item = Napi::Object::New(env);
        item.Set("ssid", SsidToString(net_list->Network[i].dot11Ssid));
        item.Set(
            "bssType",
            net_list->Network[i].dot11BssType == dot11_BSS_type_independent
                ? "adhoc"
                : "infrastructure");
        arr.Set(i, item);
      }
      WlanFreeMemory(net_list);
    }
    return arr;
  };

  out.Set("allowList", read_list(wlan_filter_list_type_user_permit));
  out.Set("denyList", read_list(wlan_filter_list_type_user_deny));
  out.Set("gpAllowList", read_list(wlan_filter_list_type_gp_permit));
  out.Set("gpDenyList", read_list(wlan_filter_list_type_gp_deny));

  BOOL* show_denied_ptr = nullptr;
  DWORD show_denied_size = 0;
  if (WlanQueryAutoConfigParameter(
          wlan.get(), wlan_autoconf_opcode_show_denied_networks, nullptr,
          &show_denied_size, reinterpret_cast<PVOID*>(&show_denied_ptr),
          nullptr) == ERROR_SUCCESS &&
      show_denied_ptr != nullptr) {
    out.Set("showDeniedNetworks", *show_denied_ptr != FALSE);
    WlanFreeMemory(show_denied_ptr);
  } else {
    out.Set("showDeniedNetworks", false);
  }

  return out;
}

// =============================================================================
// 9. Set WLAN Permit & Deny Filter Lists + Hide Denied Networks
//    Uses WlanSetFilterList + WlanSetAutoConfigParameter(wlan_autoconf_opcode_show_denied_networks)
// =============================================================================
Napi::Value SetFilterLists(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);

  if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsArray()) {
    res.Set("success", false);
    res.Set("errorMessage", "Expected (allowSsidArray, denyEntriesArray, denyAllInfrastructure, denyAllAdhoc, hideDeniedNetworks)");
    return res;
  }

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    res.Set("success", false);
    res.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    res.Set("errorMessage", Win32ErrorToString(wlan.status()));
    return res;
  }

  Napi::Array allow_arr = info[0].As<Napi::Array>();
  Napi::Array deny_arr = info[1].As<Napi::Array>();
  bool deny_all_infra = false;
  bool deny_all_adhoc = false;
  bool hide_denied = true;

  if (info.Length() >= 3 && info[2].IsBoolean()) {
    deny_all_infra = info[2].As<Napi::Boolean>().Value();
  }
  if (info.Length() >= 4 && info[3].IsBoolean()) {
    deny_all_adhoc = info[3].As<Napi::Boolean>().Value();
  }
  if (info.Length() >= 5 && info[4].IsBoolean()) {
    hide_denied = info[4].As<Napi::Boolean>().Value();
  }

  // 1) Apply User Permit List (wlan_filter_list_type_user_permit)
  DWORD allow_status = ERROR_SUCCESS;
  if (allow_arr.Length() == 0) {
    allow_status = WlanSetFilterList(
        wlan.get(), wlan_filter_list_type_user_permit, nullptr, nullptr);
  } else {
    uint32_t count = allow_arr.Length();
    size_t buf_size =
        sizeof(DOT11_NETWORK_LIST) + (count - 1) * sizeof(DOT11_NETWORK);
    std::vector<uint8_t> buf(buf_size, 0);
    auto* list = reinterpret_cast<PDOT11_NETWORK_LIST>(buf.data());
    list->dwNumberOfItems = count;
    for (uint32_t i = 0; i < count; ++i) {
      std::string ssid_str = allow_arr.Get(i).ToString().Utf8Value();
      list->Network[i].dot11Ssid = StringToSsid(ssid_str);
      list->Network[i].dot11BssType = dot11_BSS_type_infrastructure;
    }
    allow_status = WlanSetFilterList(
        wlan.get(), wlan_filter_list_type_user_permit, list, nullptr);
  }

  // 2) Apply User Deny List (wlan_filter_list_type_user_deny)
  std::vector<DOT11_NETWORK> deny_items;
  for (uint32_t i = 0; i < deny_arr.Length(); ++i) {
    Napi::Value val = deny_arr.Get(i);
    if (val.IsString()) {
      std::string ssid_str = val.As<Napi::String>().Utf8Value();
      DOT11_NETWORK net = {};
      net.dot11Ssid = StringToSsid(ssid_str);
      net.dot11BssType = dot11_BSS_type_infrastructure;
      deny_items.push_back(net);
    } else if (val.IsObject()) {
      Napi::Object obj = val.As<Napi::Object>();
      std::string ssid_str = obj.Has("ssid") ? obj.Get("ssid").ToString().Utf8Value() : "";
      std::string bss_str =
          obj.Has("bssType") ? obj.Get("bssType").ToString().Utf8Value() : "infrastructure";
      DOT11_NETWORK net = {};
      net.dot11Ssid = StringToSsid(ssid_str);
      net.dot11BssType = (bss_str == "adhoc") ? dot11_BSS_type_independent
                                              : dot11_BSS_type_infrastructure;
      deny_items.push_back(net);
    }
  }

  if (deny_all_infra) {
    DOT11_NETWORK wildcard_infra = {};
    wildcard_infra.dot11Ssid.uSSIDLength = 0;
    wildcard_infra.dot11BssType = dot11_BSS_type_infrastructure;
    deny_items.push_back(wildcard_infra);
  }
  if (deny_all_adhoc) {
    DOT11_NETWORK wildcard_adhoc = {};
    wildcard_adhoc.dot11Ssid.uSSIDLength = 0;
    wildcard_adhoc.dot11BssType = dot11_BSS_type_independent;
    deny_items.push_back(wildcard_adhoc);
  }

  DWORD deny_status = ERROR_SUCCESS;
  if (deny_items.empty()) {
    deny_status = WlanSetFilterList(
        wlan.get(), wlan_filter_list_type_user_deny, nullptr, nullptr);
  } else {
    size_t count = deny_items.size();
    size_t buf_size =
        sizeof(DOT11_NETWORK_LIST) + (count - 1) * sizeof(DOT11_NETWORK);
    std::vector<uint8_t> buf(buf_size, 0);
    auto* list = reinterpret_cast<PDOT11_NETWORK_LIST>(buf.data());
    list->dwNumberOfItems = static_cast<DWORD>(count);
    for (size_t i = 0; i < count; ++i) {
      list->Network[i] = deny_items[i];
    }
    deny_status = WlanSetFilterList(
        wlan.get(), wlan_filter_list_type_user_deny, list, nullptr);
  }

  // 3) Configure visibility of denied networks via WlanSetAutoConfigParameter
  BOOL show_denied_bool = hide_denied ? FALSE : TRUE;
  DWORD show_status = WlanSetAutoConfigParameter(
      wlan.get(), wlan_autoconf_opcode_show_denied_networks,
      sizeof(BOOL), &show_denied_bool, nullptr);

  bool ok = (allow_status == ERROR_SUCCESS && deny_status == ERROR_SUCCESS);
  res.Set("success", ok);
  res.Set("allowStatus", static_cast<uint32_t>(allow_status));
  res.Set("denyStatus", static_cast<uint32_t>(deny_status));
  res.Set("showDeniedStatus", static_cast<uint32_t>(show_status));
  if (!ok) {
    DWORD failed_code = (allow_status != ERROR_SUCCESS) ? allow_status : deny_status;
    res.Set("errorCode", static_cast<uint32_t>(failed_code));
    res.Set("errorMessage", Win32ErrorToString(failed_code));
  }
  return res;
}

// =============================================================================
// 10. Connect to a Saved WLAN Profile (WlanConnect)
// =============================================================================
Napi::Value ConnectToProfile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    res.Set("success", false);
    res.Set("errorMessage", "Expected (interfaceGuid, profileName, [ssid])");
    return res;
  }

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    res.Set("success", false);
    res.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    res.Set("errorMessage", Win32ErrorToString(wlan.status()));
    return res;
  }

  GUID target_guid = {};
  StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid);
  std::wstring profile_wide = Utf8ToWide(info[1].As<Napi::String>().Utf8Value());

  DOT11_SSID ssid_struct = {};
  bool has_ssid = false;
  if (info.Length() >= 3 && info[2].IsString()) {
    std::string ssid_str = info[2].As<Napi::String>().Utf8Value();
    if (!ssid_str.empty()) {
      ssid_struct = StringToSsid(ssid_str);
      has_ssid = true;
    }
  }

  WLAN_CONNECTION_PARAMETERS conn_params = {};
  conn_params.wlanConnectionMode = wlan_connection_mode_profile;
  conn_params.strProfile = profile_wide.c_str();
  conn_params.pDot11Ssid = has_ssid ? &ssid_struct : nullptr;
  conn_params.pDesiredBssidList = nullptr;
  conn_params.dot11BssType = dot11_BSS_type_infrastructure;
  conn_params.dwFlags = 0;

  DWORD status = WlanConnect(wlan.get(), &target_guid, &conn_params, nullptr);
  res.Set("success", status == ERROR_SUCCESS);
  res.Set("errorCode", static_cast<uint32_t>(status));
  if (status != ERROR_SUCCESS) {
    res.Set("errorMessage", Win32ErrorToString(status));
  }
  return res;
}

// =============================================================================
// 11. Turn On Software Wi-Fi Radio (WlanSetInterface + wlan_intf_opcode_radio_state)
// =============================================================================
Napi::Value SetSoftwareRadioState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
    res.Set("success", false);
    res.Set("errorMessage", "Expected (interfaceGuid, enabledBoolean)");
    return res;
  }

  ScopedWlanHandle wlan;
  if (!wlan.IsValid()) {
    res.Set("success", false);
    res.Set("errorCode", static_cast<uint32_t>(wlan.status()));
    res.Set("errorMessage", Win32ErrorToString(wlan.status()));
    return res;
  }

  GUID target_guid = {};
  StringToGuid(info[0].As<Napi::String>().Utf8Value(), &target_guid);
  bool enable = info[1].As<Napi::Boolean>().Value();

  WLAN_PHY_RADIO_STATE phy_state = {};
  phy_state.dwPhyIndex = 0;
  phy_state.dot11SoftwareRadioState =
      enable ? dot11_radio_state_on : dot11_radio_state_off;
  phy_state.dot11HardwareRadioState = dot11_radio_state_on;

  DWORD status = WlanSetInterface(
      wlan.get(), &target_guid, wlan_intf_opcode_radio_state,
      sizeof(WLAN_PHY_RADIO_STATE), &phy_state, nullptr);
  res.Set("success", status == ERROR_SUCCESS);
  res.Set("errorCode", static_cast<uint32_t>(status));
  if (status != ERROR_SUCCESS) {
    res.Set("errorMessage", Win32ErrorToString(status));
  }
  return res;
}

// =============================================================================
// 12. Read & Apply Windows 10 Policy & Registry Restrictions
// =============================================================================
Napi::Value GetPolicyState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object state = Napi::Object::New(env);

  std::string settings_vis;
  bool has_settings_vis = ReadRegistryString(
      HKEY_LOCAL_MACHINE,
      L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
      L"SettingsPageVisibility",
      &settings_vis);
  state.Set("hasSettingsPageVisibility", has_settings_vis);
  state.Set("settingsPageVisibility", has_settings_vis ? settings_vis : "");

  DWORD no_net_setup = 0;
  bool has_no_net_setup = ReadRegistryDword(
      HKEY_LOCAL_MACHINE,
      L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Network",
      L"NoNetSetup",
      &no_net_setup);
  state.Set("hasNoNetSetup", has_no_net_setup);
  state.Set("noNetSetup", has_no_net_setup ? no_net_setup : 0);

  // Query WLAN security descriptor for per-user profile creation (wlan_secure_add_new_per_user_profiles)
  ScopedWlanHandle wlan;
  if (wlan.IsValid()) {
    LPWSTR sddl_str = nullptr;
    WLAN_OPCODE_VALUE_TYPE val_type = wlan_opcode_value_type_invalid;
    DWORD granted = 0;
    if (WlanGetSecuritySettings(
            wlan.get(), wlan_secure_add_new_per_user_profiles, &val_type, &sddl_str,
            &granted) == ERROR_SUCCESS &&
        sddl_str != nullptr) {
      state.Set("userProfileSddl", WideToUtf8(sddl_str));
      WlanFreeMemory(sddl_str);
    } else {
      state.Set("userProfileSddl", "");
    }
  } else {
    state.Set("userProfileSddl", "");
  }

  return state;
}

Napi::Value ApplyPolicyState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);

  if (info.Length() < 1 || !info[0].IsObject()) {
    res.Set("success", false);
    res.Set("errorMessage", "Expected policy configuration object");
    return res;
  }

  Napi::Object cfg = info[0].As<Napi::Object>();

  // 1) Explorer Policy: SettingsPageVisibility
  if (cfg.Has("settingsPageVisibility")) {
    HKEY hKey = nullptr;
    LONG open_res = RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
        0, nullptr, REG_OPTION_NON_VOLATILE, KEY_SET_VALUE | KEY_WOW64_64KEY,
        nullptr, &hKey, nullptr);
    if (open_res != ERROR_SUCCESS) {
      res.Set("success", false);
      res.Set("errorCode", static_cast<uint32_t>(open_res));
      res.Set("errorMessage", Win32ErrorToString(open_res));
      return res;
    }

    if (cfg.Get("settingsPageVisibility").IsNull()) {
      RegDeleteValueW(hKey, L"SettingsPageVisibility");
    } else {
      std::wstring val =
          Utf8ToWide(cfg.Get("settingsPageVisibility").ToString().Utf8Value());
      RegSetValueExW(
          hKey, L"SettingsPageVisibility", 0, REG_SZ,
          reinterpret_cast<const BYTE*>(val.c_str()),
          static_cast<DWORD>((val.size() + 1) * sizeof(wchar_t)));
    }
    RegCloseKey(hKey);
  }

  // 2) Network Policy: NoNetSetup
  if (cfg.Has("noNetSetup")) {
    HKEY hKey = nullptr;
    if (RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Network",
            0, nullptr, REG_OPTION_NON_VOLATILE, KEY_SET_VALUE | KEY_WOW64_64KEY,
            nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
      if (cfg.Get("noNetSetup").IsNull()) {
        RegDeleteValueW(hKey, L"NoNetSetup");
      } else {
        DWORD dval = cfg.Get("noNetSetup").ToNumber().Uint32Value();
        RegSetValueExW(
            hKey, L"NoNetSetup", 0, REG_DWORD,
            reinterpret_cast<const BYTE*>(&dval), sizeof(DWORD));
      }
      RegCloseKey(hKey);
    }
  }

  // 3) Optional: WlanSetSecuritySettings on wlan_secure_add_new_per_user_profiles
  if (cfg.Has("userProfileSddl") && cfg.Get("userProfileSddl").IsString()) {
    std::string sddl = cfg.Get("userProfileSddl").As<Napi::String>().Utf8Value();
    if (!sddl.empty()) {
      ScopedWlanHandle wlan;
      if (wlan.IsValid()) {
        std::wstring wsddl = Utf8ToWide(sddl);
        WlanSetSecuritySettings(wlan.get(), wlan_secure_add_new_per_user_profiles, wsddl.c_str());
      }
    }
  }

  // Trigger native Windows Group Policy refresh
  RefreshPolicyEx(TRUE, RP_FORCE);
  RefreshPolicyEx(FALSE, RP_FORCE);

  res.Set("success", true);
  return res;
}

// =============================================================================
// 13. Start & Stop Real-Time Native WLAN Event Notifications
// =============================================================================
Napi::Value StartNotifications(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_notif_mutex);

  if (g_notif_active.load()) {
    return Napi::Boolean::New(env, true);
  }
  if (info.Length() < 1 || !info[0].IsFunction()) {
    return Napi::Boolean::New(env, false);
  }

  DWORD negotiated = 0;
  if (WlanOpenHandle(2, nullptr, &negotiated, &g_notif_wlan_handle) != ERROR_SUCCESS ||
      g_notif_wlan_handle == nullptr) {
    return Napi::Boolean::New(env, false);
  }

  g_notif_tsfn = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "WlanNotificationTSFN", 0, 1);

  DWORD prev_source = 0;
  DWORD reg_res = WlanRegisterNotification(
      g_notif_wlan_handle,
      WLAN_NOTIFICATION_SOURCE_ACM | WLAN_NOTIFICATION_SOURCE_MSM,
      TRUE,
      OnWlanNotificationCallback,
      nullptr,
      nullptr,
      &prev_source);

  if (reg_res != ERROR_SUCCESS) {
    g_notif_tsfn.Release();
    WlanCloseHandle(g_notif_wlan_handle, nullptr);
    g_notif_wlan_handle = nullptr;
    return Napi::Boolean::New(env, false);
  }

  g_notif_active.store(true);
  return Napi::Boolean::New(env, true);
}

Napi::Value StopNotifications(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_notif_mutex);

  if (!g_notif_active.load()) {
    return Napi::Boolean::New(env, true);
  }

  g_notif_active.store(false);
  if (g_notif_wlan_handle != nullptr) {
    DWORD prev_source = 0;
    WlanRegisterNotification(
        g_notif_wlan_handle, WLAN_NOTIFICATION_SOURCE_NONE, TRUE,
        nullptr, nullptr, nullptr, &prev_source);
    WlanCloseHandle(g_notif_wlan_handle, nullptr);
    g_notif_wlan_handle = nullptr;
  }
  g_notif_tsfn.Release();
  return Napi::Boolean::New(env, true);
}

#else  // Non-Windows build fallback

Napi::Value IsProcessElevated(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value RequestUacElevation(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  o.Set("errorMessage", "Windows 10 Pro x64 required");
  return o;
}
Napi::Value GetWlanStatus(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("wlanServiceRunning", false);
  o.Set("interfaces", Napi::Array::New(info.Env(), 0));
  return o;
}
Napi::Value GetAvailableNetworks(const Napi::CallbackInfo& info) {
  return Napi::Array::New(info.Env(), 0);
}
Napi::Value GetProfiles(const Napi::CallbackInfo& info) {
  return Napi::Array::New(info.Env(), 0);
}
Napi::Value SetProfileXml(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value SetPreferredProfilePosition(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value GetFilterLists(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("allowList", Napi::Array::New(info.Env(), 0));
  o.Set("denyList", Napi::Array::New(info.Env(), 0));
  o.Set("showDeniedNetworks", false);
  return o;
}
Napi::Value SetFilterLists(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value ConnectToProfile(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value SetSoftwareRadioState(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value GetPolicyState(const Napi::CallbackInfo& info) {
  return Napi::Object::New(info.Env());
}
Napi::Value ApplyPolicyState(const Napi::CallbackInfo& info) {
  Napi::Object o = Napi::Object::New(info.Env());
  o.Set("success", false);
  return o;
}
Napi::Value StartNotifications(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}
Napi::Value StopNotifications(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isProcessElevated", Napi::Function::New(env, IsProcessElevated));
  exports.Set("requestUacElevation", Napi::Function::New(env, RequestUacElevation));
  exports.Set("getWlanStatus", Napi::Function::New(env, GetWlanStatus));
  exports.Set("getAvailableNetworks", Napi::Function::New(env, GetAvailableNetworks));
  exports.Set("getProfiles", Napi::Function::New(env, GetProfiles));
  exports.Set("setProfileXml", Napi::Function::New(env, SetProfileXml));
  exports.Set("setPreferredProfilePosition", Napi::Function::New(env, SetPreferredProfilePosition));
  exports.Set("getFilterLists", Napi::Function::New(env, GetFilterLists));
  exports.Set("setFilterLists", Napi::Function::New(env, SetFilterLists));
  exports.Set("connectToProfile", Napi::Function::New(env, ConnectToProfile));
  exports.Set("setSoftwareRadioState", Napi::Function::New(env, SetSoftwareRadioState));
  exports.Set("getPolicyState", Napi::Function::New(env, GetPolicyState));
  exports.Set("applyPolicyState", Napi::Function::New(env, ApplyPolicyState));
  exports.Set("startNotifications", Napi::Function::New(env, StartNotifications));
  exports.Set("stopNotifications", Napi::Function::New(env, StopNotifications));
  return exports;
}

NODE_API_MODULE(wlan_native, Init)
