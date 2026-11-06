using System;
using System.Runtime.InteropServices;
using System.Text;

namespace WiFiLabGuardian
{
    public static class NativeWlan
    {
        public const uint WLAN_API_VERSION_2_0 = 2;
        public const uint ERROR_SUCCESS = 0;
        public const uint RP_FORCE = 1;

        public enum WLAN_INTERFACE_STATE
        {
            wlan_interface_state_not_ready = 0,
            wlan_interface_state_connected = 1,
            wlan_interface_state_ad_hoc_network_formed = 2,
            wlan_interface_state_disconnecting = 3,
            wlan_interface_state_disconnected = 4,
            wlan_interface_state_associating = 5,
            wlan_interface_state_discovering = 6,
            wlan_interface_state_authenticating = 7
        }

        public enum WLAN_INTF_OPCODE
        {
            wlan_intf_opcode_autoconf_start = 0x000000000,
            wlan_intf_opcode_autoconf_enabled,
            wlan_intf_opcode_background_scan_enabled,
            wlan_intf_opcode_media_streaming_mode,
            wlan_intf_opcode_radio_state,
            wlan_intf_opcode_bss_type,
            wlan_intf_opcode_interface_state,
            wlan_intf_opcode_current_connection,
            wlan_intf_opcode_channel_number,
            wlan_intf_opcode_supported_infrastructure_auth_cipher_pairs,
            wlan_intf_opcode_supported_adhoc_auth_cipher_pairs,
            wlan_intf_opcode_supported_country_or_region_string_list,
            wlan_intf_opcode_current_operation_mode,
            wlan_intf_opcode_supported_safe_mode,
            wlan_intf_opcode_certified_safe_mode,
            wlan_intf_opcode_hosted_network_capable,
            wlan_intf_opcode_management_frame_protection_capable,
            wlan_intf_opcode_autoconf_end = 0x0fffffff
        }

        public enum WLAN_OPCODE_VALUE_TYPE
        {
            wlan_opcode_value_type_query_only = 0,
            wlan_opcode_value_type_set_by_group_policy = 1,
            wlan_opcode_value_type_set_by_user = 2,
            wlan_opcode_value_type_invalid = 3
        }

        public enum WLAN_FILTER_LIST_TYPE
        {
            wlan_filter_list_type_gp_permit,
            wlan_filter_list_type_gp_deny,
            wlan_filter_list_type_user_permit,
            wlan_filter_list_type_user_deny
        }

        public enum WLAN_AUTOCONF_OPCODE
        {
            wlan_autoconf_opcode_start = 0,
            wlan_autoconf_opcode_show_denied_networks = 1,
            wlan_autoconf_opcode_power_setting = 2,
            wlan_autoconf_opcode_only_use_gp_profiles_for_allowed_networks = 3,
            wlan_autoconf_opcode_allow_explicit_creds = 4,
            wlan_autoconf_opcode_block_period = 5,
            wlan_autoconf_opcode_allow_virtual_station_extensibility = 6,
            wlan_autoconf_opcode_end = 7
        }

        public enum WLAN_SECURABLE_OBJECT
        {
            wlan_secure_permit_list = 0,
            wlan_secure_deny_list,
            wlan_secure_ac_enabled,
            wlan_secure_bc_scan_enabled,
            wlan_secure_bss_type,
            wlan_secure_show_denied,
            wlan_secure_interface_properties,
            wlan_secure_ihv_control,
            wlan_secure_all_user_profiles_order,
            wlan_secure_add_new_all_user_profiles,
            wlan_secure_add_new_per_user_profiles,
            wlan_secure_media_streaming_mode_enabled,
            wlan_secure_current_operation_mode,
            wlan_secure_get_plaintext_key,
            wlan_secure_hosted_network_elevated_access,
            wlan_secure_virtual_station_extensibility,
            wlan_secure_wfd_elevated_access,
            WLAN_SECURABLE_OBJECT_COUNT
        }

        public enum DOT11_BSS_TYPE
        {
            dot11_BSS_type_infrastructure = 1,
            dot11_BSS_type_independent = 2,
            dot11_BSS_type_any = 3
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        public struct DOT11_SSID
        {
            public uint uSSIDLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public byte[] ucSSID;

            public string GetSsidString()
            {
                if (uSSIDLength == 0 || ucSSID == null) return string.Empty;
                int len = Math.Min((int)uSSIDLength, ucSSID.Length);
                return Encoding.UTF8.GetString(ucSSID, 0, len);
            }

            public static DOT11_SSID FromString(string ssid)
            {
                DOT11_SSID s = new DOT11_SSID();
                if (string.IsNullOrEmpty(ssid))
                {
                    s.uSSIDLength = 0;
                    s.ucSSID = new byte[32];
                    return s;
                }
                byte[] bytes = Encoding.UTF8.GetBytes(ssid);
                s.uSSIDLength = (uint)Math.Min(bytes.Length, 32);
                s.ucSSID = new byte[32];
                Array.Copy(bytes, s.ucSSID, (int)s.uSSIDLength);
                return s;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DOT11_NETWORK
        {
            public DOT11_SSID dot11Ssid;
            public DOT11_BSS_TYPE dot11BssType;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WLAN_INTERFACE_INFO
        {
            public Guid InterfaceGuid;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string strInterfaceDescription;
            public WLAN_INTERFACE_STATE isState;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct WLAN_ASSOCIATION_ATTRIBUTES
        {
            public DOT11_SSID dot11Ssid;
            public DOT11_BSS_TYPE dot11BssType;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
            public byte[] dot11Bssid;
            public uint dot11PhyType;
            public uint uDot11PhyIndex;
            public uint wlanSignalQuality;
            public uint ulRxRate;
            public uint ulTxRate;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WLAN_CONNECTION_ATTRIBUTES
        {
            public WLAN_INTERFACE_STATE isState;
            public uint wlanConnectionMode;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string strProfileName;
            public WLAN_ASSOCIATION_ATTRIBUTES wlanAssociationAttributes;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
            public byte[] wlanSecurityAttributes;
        }

        [DllImport("wlanapi.dll")]
        public static extern uint WlanOpenHandle(
            uint dwClientVersion,
            IntPtr pReserved,
            out uint pdwNegotiatedVersion,
            out IntPtr phClientHandle);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanCloseHandle(
            IntPtr hClientHandle,
            IntPtr pReserved);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanEnumInterfaces(
            IntPtr hClientHandle,
            IntPtr pReserved,
            out IntPtr ppInterfaceList);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanQueryInterface(
            IntPtr hClientHandle,
            ref Guid pInterfaceGuid,
            WLAN_INTF_OPCODE OpCode,
            IntPtr pReserved,
            out uint pdwDataSize,
            out IntPtr ppData,
            out WLAN_OPCODE_VALUE_TYPE pWlanOpcodeValueType);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanSetFilterList(
            IntPtr hClientHandle,
            WLAN_FILTER_LIST_TYPE wlanFilterListType,
            IntPtr pNetworkList,
            IntPtr pReserved);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanGetFilterList(
            IntPtr hClientHandle,
            WLAN_FILTER_LIST_TYPE wlanFilterListType,
            IntPtr pReserved,
            out IntPtr ppNetworkList);

        [DllImport("wlanapi.dll")]
        public static extern uint WlanSetAutoConfigParameter(
            IntPtr hClientHandle,
            WLAN_AUTOCONF_OPCODE OpCode,
            uint dwDataSize,
            IntPtr pData,
            IntPtr pReserved);

        [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)]
        public static extern uint WlanSetSecuritySettings(
            IntPtr hClientHandle,
            WLAN_SECURABLE_OBJECT SecurableObject,
            string strModifiedSDDL);

        [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)]
        public static extern uint WlanSetProfilePosition(
            IntPtr hClientHandle,
            ref Guid pInterfaceGuid,
            string strProfileName,
            uint dwPosition,
            IntPtr pReserved);

        [DllImport("wlanapi.dll")]
        public static extern void WlanFreeMemory(IntPtr pMemory);

        [DllImport("userenv.dll", SetLastError = true)]
        public static extern bool RefreshPolicyEx(bool bMachine, uint dwOptions);
    }
}
