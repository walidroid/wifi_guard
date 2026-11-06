using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace WiFiLabGuardian
{
    public class ProtectionController
    {
        private const string LOCKED_SDDL = "D:(A;;0x7;;;BA)(A;;0x7;;;SY)(A;;0x7;;;NO)(A;;0x3;;;IU)";
        private const string REG_POLICY_EXPLORER = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer";
        private const string VAL_SETTINGS_VISIBILITY = "SettingsPageVisibility";
        private const string AIRPLANE_TOKEN = "network-airplanemode";

        private const string REG_QUICK_ACTIONS_ALL = @"SOFTWARE\Microsoft\Windows\CurrentVersion\ActionCenter\Quick Actions\All";
        private const string KEY_AIRPLANE_QA = "SystemSettings_Radio_IsAirplaneModeEnabled";
        private const string KEY_AIRPLANE_QA_DISABLED = "SystemSettings_Radio_IsAirplaneModeEnabled.Disabled";
        private const string REG_UNPINNED_BY_DEFAULT = @"SOFTWARE\Microsoft\Windows\CurrentVersion\ActionCenter\Quick Actions\UnpinnedByDefault";
        private const string REG_HKCU_UNPINNED = @"Control Panel\Quick Actions\Control Center\Unpinned";
        private const string REG_RMSVC = @"SYSTEM\CurrentControlSet\Services\RmSvc";
        private const string REG_RADIO_STATE = @"SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState";

        public struct WifiInfo
        {
            public bool HasAdapter;
            public Guid InterfaceGuid;
            public string AdapterDescription;
            public string ConnectedSsid;
            public uint SignalQuality;
            public bool IsConnected;
        }

        public WifiInfo GetCurrentWifiInfo()
        {
            WifiInfo info = new WifiInfo
            {
                HasAdapter = false,
                InterfaceGuid = Guid.Empty,
                AdapterDescription = "Aucune carte Wi-Fi détectée",
                ConnectedSsid = string.Empty,
                SignalQuality = 0,
                IsConnected = false
            };

            IntPtr hClient = IntPtr.Zero;
            uint negotiatedVersion;
            uint res = NativeWlan.WlanOpenHandle(NativeWlan.WLAN_API_VERSION_2_0, IntPtr.Zero, out negotiatedVersion, out hClient);
            if (res != NativeWlan.ERROR_SUCCESS || hClient == IntPtr.Zero)
            {
                return info;
            }

            try
            {
                IntPtr pIfList = IntPtr.Zero;
                res = NativeWlan.WlanEnumInterfaces(hClient, IntPtr.Zero, out pIfList);
                if (res != NativeWlan.ERROR_SUCCESS || pIfList == IntPtr.Zero)
                {
                    return info;
                }

                try
                {
                    uint count = (uint)Marshal.ReadInt32(pIfList, 0);
                    if (count == 0) return info;

                    for (int i = 0; i < count; i++)
                    {
                        IntPtr pItem = new IntPtr(pIfList.ToInt64() + 8 + i * Marshal.SizeOf(typeof(NativeWlan.WLAN_INTERFACE_INFO)));
                        NativeWlan.WLAN_INTERFACE_INFO iface = (NativeWlan.WLAN_INTERFACE_INFO)Marshal.PtrToStructure(pItem, typeof(NativeWlan.WLAN_INTERFACE_INFO));

                        info.HasAdapter = true;
                        info.InterfaceGuid = iface.InterfaceGuid;
                        info.AdapterDescription = iface.strInterfaceDescription;

                        if (iface.isState == NativeWlan.WLAN_INTERFACE_STATE.wlan_interface_state_connected)
                        {
                            info.IsConnected = true;
                            uint dataSize;
                            IntPtr pData;
                            NativeWlan.WLAN_OPCODE_VALUE_TYPE valType;
                            Guid guid = iface.InterfaceGuid;

                            if (NativeWlan.WlanQueryInterface(
                                    hClient,
                                    ref guid,
                                    NativeWlan.WLAN_INTF_OPCODE.wlan_intf_opcode_current_connection,
                                    IntPtr.Zero,
                                    out dataSize,
                                    out pData,
                                    out valType) == NativeWlan.ERROR_SUCCESS && pData != IntPtr.Zero)
                            {
                                try
                                {
                                    NativeWlan.WLAN_CONNECTION_ATTRIBUTES conn = (NativeWlan.WLAN_CONNECTION_ATTRIBUTES)Marshal.PtrToStructure(pData, typeof(NativeWlan.WLAN_CONNECTION_ATTRIBUTES));
                                    info.ConnectedSsid = conn.wlanAssociationAttributes.dot11Ssid.GetSsidString();
                                    info.SignalQuality = conn.wlanAssociationAttributes.wlanSignalQuality;
                                    break; // Trouvé l'interface connectée active
                                }
                                finally
                                {
                                    NativeWlan.WlanFreeMemory(pData);
                                }
                            }
                        }
                    }
                }
                finally
                {
                    NativeWlan.WlanFreeMemory(pIfList);
                }
            }
            catch { }
            finally
            {
                NativeWlan.WlanCloseHandle(hClient, IntPtr.Zero);
            }

            return info;
        }

        public bool IsWifiProtectionActive(out string permittedSsid)
        {
            permittedSsid = string.Empty;
            IntPtr hClient = IntPtr.Zero;
            uint negotiatedVersion;
            if (NativeWlan.WlanOpenHandle(NativeWlan.WLAN_API_VERSION_2_0, IntPtr.Zero, out negotiatedVersion, out hClient) != NativeWlan.ERROR_SUCCESS)
            {
                return false;
            }

            try
            {
                IntPtr pList = IntPtr.Zero;
                uint res = NativeWlan.WlanGetFilterList(hClient, NativeWlan.WLAN_FILTER_LIST_TYPE.wlan_filter_list_type_user_permit, IntPtr.Zero, out pList);
                if (res == NativeWlan.ERROR_SUCCESS && pList != IntPtr.Zero)
                {
                    try
                    {
                        uint count = (uint)Marshal.ReadInt32(pList, 0);
                        if (count > 0)
                        {
                            IntPtr pNet = new IntPtr(pList.ToInt64() + 8);
                            NativeWlan.DOT11_NETWORK net = (NativeWlan.DOT11_NETWORK)Marshal.PtrToStructure(pNet, typeof(NativeWlan.DOT11_NETWORK));
                            permittedSsid = net.dot11Ssid.GetSsidString();
                            return true;
                        }
                    }
                    finally
                    {
                        NativeWlan.WlanFreeMemory(pList);
                    }
                }
            }
            catch { }
            finally
            {
                NativeWlan.WlanCloseHandle(hClient, IntPtr.Zero);
            }

            return false;
        }

        public bool EnableWifiProtection(string targetSsid, out string message)
        {
            message = string.Empty;
            if (string.IsNullOrEmpty(targetSsid))
            {
                message = "Aucun SSID spécifié pour la protection.";
                return false;
            }

            IntPtr hClient = IntPtr.Zero;
            uint negotiatedVersion;
            uint res = NativeWlan.WlanOpenHandle(NativeWlan.WLAN_API_VERSION_2_0, IntPtr.Zero, out negotiatedVersion, out hClient);
            if (res != NativeWlan.ERROR_SUCCESS)
            {
                message = "Impossible d'ouvrir le gestionnaire WLAN (wlanapi.dll). Privilèges administrateur requis.";
                return false;
            }

            try
            {
                // 1. Configurer la liste blanche (User Permit List)
                IntPtr pPermit = AllocateNetworkList(new List<NativeWlan.DOT11_NETWORK>
                {
                    new NativeWlan.DOT11_NETWORK
                    {
                        dot11Ssid = NativeWlan.DOT11_SSID.FromString(targetSsid),
                        dot11BssType = NativeWlan.DOT11_BSS_TYPE.dot11_BSS_type_infrastructure
                    }
                });

                try
                {
                    res = NativeWlan.WlanSetFilterList(hClient, NativeWlan.WLAN_FILTER_LIST_TYPE.wlan_filter_list_type_user_permit, pPermit, IntPtr.Zero);
                    if (res != NativeWlan.ERROR_SUCCESS)
                    {
                        message = "Erreur WlanSetFilterList (Permit List) : code " + res;
                        return false;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(pPermit);
                }

                // 2. Configurer la liste noire (User Deny List) avec wildcard pour bloquer tous les autres
                IntPtr pDeny = AllocateNetworkList(new List<NativeWlan.DOT11_NETWORK>
                {
                    new NativeWlan.DOT11_NETWORK
                    {
                        dot11Ssid = new NativeWlan.DOT11_SSID { uSSIDLength = 0, ucSSID = new byte[32] },
                        dot11BssType = NativeWlan.DOT11_BSS_TYPE.dot11_BSS_type_infrastructure
                    },
                    new NativeWlan.DOT11_NETWORK
                    {
                        dot11Ssid = new NativeWlan.DOT11_SSID { uSSIDLength = 0, ucSSID = new byte[32] },
                        dot11BssType = NativeWlan.DOT11_BSS_TYPE.dot11_BSS_type_independent
                    }
                });

                try
                {
                    res = NativeWlan.WlanSetFilterList(hClient, NativeWlan.WLAN_FILTER_LIST_TYPE.wlan_filter_list_type_user_deny, pDeny, IntPtr.Zero);
                    if (res != NativeWlan.ERROR_SUCCESS)
                    {
                        message = "Erreur WlanSetFilterList (Deny List) : code " + res;
                        return false;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(pDeny);
                }

                // 3. Masquer les réseaux bloqués de l'affichage Windows (wlan_autoconf_opcode_show_denied_networks = FALSE)
                IntPtr pBool = Marshal.AllocHGlobal(sizeof(int));
                try
                {
                    Marshal.WriteInt32(pBool, 0); // FALSE
                    NativeWlan.WlanSetAutoConfigParameter(
                        hClient,
                        NativeWlan.WLAN_AUTOCONF_OPCODE.wlan_autoconf_opcode_show_denied_networks,
                        sizeof(int),
                        pBool,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(pBool);
                }

                // 4. Verrouiller la création de profils Wi-Fi personnels par des utilisateurs non-administrateurs (DACL)
                NativeWlan.WlanSetSecuritySettings(
                    hClient,
                    NativeWlan.WLAN_SECURABLE_OBJECT.wlan_secure_add_new_per_user_profiles,
                    LOCKED_SDDL);

                // 5. Rafraîchir les stratégies Windows
                NativeWlan.RefreshPolicyEx(true, NativeWlan.RP_FORCE);
                NativeWlan.RefreshPolicyEx(false, NativeWlan.RP_FORCE);

                message = string.Format("Protection Wi-Fi activée avec succès sur le réseau \"{0}\".", targetSsid);
                return true;
            }
            catch (Exception ex)
            {
                message = "Exception : " + ex.Message;
                return false;
            }
            finally
            {
                NativeWlan.WlanCloseHandle(hClient, IntPtr.Zero);
            }
        }

        public bool DisableWifiProtection(out string message)
        {
            message = string.Empty;
            IntPtr hClient = IntPtr.Zero;
            uint negotiatedVersion;
            uint res = NativeWlan.WlanOpenHandle(NativeWlan.WLAN_API_VERSION_2_0, IntPtr.Zero, out negotiatedVersion, out hClient);
            if (res != NativeWlan.ERROR_SUCCESS)
            {
                message = "Impossible d'ouvrir le gestionnaire WLAN (wlanapi.dll).";
                return false;
            }

            try
            {
                // 1. Réinitialiser la liste blanche (NULL / Empty)
                IntPtr pEmpty = AllocateNetworkList(new List<NativeWlan.DOT11_NETWORK>());
                try
                {
                    NativeWlan.WlanSetFilterList(hClient, NativeWlan.WLAN_FILTER_LIST_TYPE.wlan_filter_list_type_user_permit, pEmpty, IntPtr.Zero);
                    NativeWlan.WlanSetFilterList(hClient, NativeWlan.WLAN_FILTER_LIST_TYPE.wlan_filter_list_type_user_deny, pEmpty, IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(pEmpty);
                }

                // 2. Rétablir la visibilité des réseaux (show_denied = TRUE)
                IntPtr pBool = Marshal.AllocHGlobal(sizeof(int));
                try
                {
                    Marshal.WriteInt32(pBool, 1); // TRUE
                    NativeWlan.WlanSetAutoConfigParameter(
                        hClient,
                        NativeWlan.WLAN_AUTOCONF_OPCODE.wlan_autoconf_opcode_show_denied_networks,
                        sizeof(int),
                        pBool,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(pBool);
                }

                // 3. Rafraîchir les stratégies Windows
                NativeWlan.RefreshPolicyEx(true, NativeWlan.RP_FORCE);
                NativeWlan.RefreshPolicyEx(false, NativeWlan.RP_FORCE);

                message = "Protection Wi-Fi désactivée. Tous les réseaux sont à nouveau autorisés.";
                return true;
            }
            catch (Exception ex)
            {
                message = "Exception : " + ex.Message;
                return false;
            }
            finally
            {
                NativeWlan.WlanCloseHandle(hClient, IntPtr.Zero);
            }
        }

        public bool IsAirplaneModeHidden()
        {
            try
            {
                // 1. Vérifier si le service Radio (RmSvc) est désactivé
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(REG_RMSVC, false))
                {
                    if (key != null)
                    {
                        object startVal = key.GetValue("Start");
                        if (startVal != null && Convert.ToInt32(startVal) == 4)
                        {
                            return true;
                        }
                    }
                }

                // 2. Vérifier si la tuile Action Center est désactivée / renommée
                using (RegistryKey allKey = Registry.LocalMachine.OpenSubKey(REG_QUICK_ACTIONS_ALL, false))
                {
                    if (allKey != null)
                    {
                        using (RegistryKey disabledKey = allKey.OpenSubKey(KEY_AIRPLANE_QA_DISABLED, false))
                        {
                            if (disabledKey != null) return true;
                        }
                    }
                }

                // 3. Vérifier la visibilité dans les Paramètres Windows
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(REG_POLICY_EXPLORER, false))
                {
                    if (key != null)
                    {
                        object val = key.GetValue(VAL_SETTINGS_VISIBILITY);
                        if (val != null && val.ToString().IndexOf(AIRPLANE_TOKEN, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            return true;
                        }
                    }
                }
            }
            catch { }

            return false;
        }

        public bool SetAirplaneModeHidden(bool hide, out string message)
        {
            message = string.Empty;
            try
            {
                // 1. Neutraliser ou rétablir le service Radio Management (RmSvc)
                SetRmSvcState(hide);

                // 2. Masquer la tuile "Mode Avion" dans le catalogue Action Center / Menu réseau
                using (RegistryKey allKey = Registry.LocalMachine.OpenSubKey(REG_QUICK_ACTIONS_ALL, true))
                {
                    if (allKey != null)
                    {
                        if (hide)
                        {
                            using (RegistryKey src = allKey.OpenSubKey(KEY_AIRPLANE_QA, false))
                            {
                                if (src != null)
                                {
                                    using (RegistryKey dst = allKey.CreateSubKey(KEY_AIRPLANE_QA_DISABLED))
                                    {
                                        CopyRegistryKey(src, dst);
                                    }
                                    allKey.DeleteSubKeyTree(KEY_AIRPLANE_QA, false);
                                }
                            }
                        }
                        else
                        {
                            using (RegistryKey src = allKey.OpenSubKey(KEY_AIRPLANE_QA_DISABLED, false))
                            {
                                if (src != null)
                                {
                                    using (RegistryKey dst = allKey.CreateSubKey(KEY_AIRPLANE_QA))
                                    {
                                        CopyRegistryKey(src, dst);
                                    }
                                    allKey.DeleteSubKeyTree(KEY_AIRPLANE_QA_DISABLED, false);
                                }
                                else
                                {
                                    // Reconstitution des clés par défaut si absente
                                    using (RegistryKey dst = allKey.CreateSubKey(KEY_AIRPLANE_QA))
                                    {
                                        dst.SetValue("AppId", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel", RegistryValueKind.String);
                                        dst.SetValue("Args", "page=SettingsPageNetworkAirplaneMode&target=SystemSettings_Radio_IsAirplaneModeEnabled_SettingsApp", RegistryValueKind.String);
                                        dst.SetValue("FriendlyName", "Microsoft.QuickAction.AirplaneMode", RegistryValueKind.String);
                                        dst.SetValue("Group", "SettingsGroupAirplaneMode", RegistryValueKind.String);
                                        dst.SetValue("Icon", 59145, RegistryValueKind.DWord);
                                        dst.SetValue("Page", "SettingsPageNetworkAirplaneMode", RegistryValueKind.String);
                                        dst.SetValue("Title", 106, RegistryValueKind.DWord);
                                        dst.SetValue("Type", 0, RegistryValueKind.DWord);
                                    }
                                }
                            }
                        }
                    }
                }

                // 3. Configurer UnpinnedByDefault au niveau machine (HKLM)
                using (RegistryKey unpinnedKey = Registry.LocalMachine.OpenSubKey(REG_UNPINNED_BY_DEFAULT, true))
                {
                    if (unpinnedKey != null)
                    {
                        if (hide)
                        {
                            unpinnedKey.SetValue(KEY_AIRPLANE_QA, "", RegistryValueKind.String);
                        }
                        else
                        {
                            unpinnedKey.DeleteValue(KEY_AIRPLANE_QA, false);
                        }
                    }
                }

                // 4. Configurer Unpinned au niveau session utilisateur (HKCU)
                try
                {
                    using (RegistryKey hkcuUnpinned = Registry.CurrentUser.CreateSubKey(REG_HKCU_UNPINNED))
                    {
                        if (hkcuUnpinned != null)
                        {
                            if (hide)
                            {
                                hkcuUnpinned.SetValue("Microsoft.QuickAction.AirplaneMode", new byte[0], RegistryValueKind.None);
                                hkcuUnpinned.SetValue(KEY_AIRPLANE_QA, new byte[0], RegistryValueKind.None);
                            }
                            else
                            {
                                hkcuUnpinned.DeleteValue("Microsoft.QuickAction.AirplaneMode", false);
                                hkcuUnpinned.DeleteValue(KEY_AIRPLANE_QA, false);
                            }
                        }
                    }
                }
                catch { }

                // 5. Masquer la page dans l'application Paramètres Windows (SettingsPageVisibility)
                using (RegistryKey key = Registry.LocalMachine.CreateSubKey(REG_POLICY_EXPLORER))
                {
                    if (key != null)
                    {
                        string current = (key.GetValue(VAL_SETTINGS_VISIBILITY) ?? string.Empty).ToString();

                        if (hide)
                        {
                            if (current.IndexOf(AIRPLANE_TOKEN, StringComparison.OrdinalIgnoreCase) < 0)
                            {
                                string updated;
                                if (string.IsNullOrEmpty(current))
                                {
                                    updated = "hide:" + AIRPLANE_TOKEN;
                                }
                                else if (current.StartsWith("hide:", StringComparison.OrdinalIgnoreCase))
                                {
                                    updated = current + ";" + AIRPLANE_TOKEN;
                                }
                                else
                                {
                                    updated = "hide:" + AIRPLANE_TOKEN + ";" + current;
                                }
                                key.SetValue(VAL_SETTINGS_VISIBILITY, updated, RegistryValueKind.String);
                            }
                        }
                        else
                        {
                            if (!string.IsNullOrEmpty(current) && current.IndexOf(AIRPLANE_TOKEN, StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                string updated = current;
                                updated = updated.Replace(";" + AIRPLANE_TOKEN, "");
                                updated = updated.Replace(AIRPLANE_TOKEN + ";", "");
                                updated = updated.Replace(AIRPLANE_TOKEN, "");
                                if (updated.Trim().Equals("hide:", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(updated.Trim()))
                                {
                                    key.DeleteValue(VAL_SETTINGS_VISIBILITY, false);
                                }
                                else
                                {
                                    key.SetValue(VAL_SETTINGS_VISIBILITY, updated, RegistryValueKind.String);
                                }
                            }
                        }
                    }
                }

                // 6. Rafraîchir les stratégies Windows
                NativeWlan.RefreshPolicyEx(true, NativeWlan.RP_FORCE);
                NativeWlan.RefreshPolicyEx(false, NativeWlan.RP_FORCE);

                if (hide)
                {
                    message = "Le Mode Avion est désormais TOTALEMENT MASQUÉ et DÉSACTIVÉ (Barre des tâches, Raccourcis clavier & Paramètres).";
                }
                else
                {
                    message = "Le Mode Avion est désormais RÉTABLI et VISIBLE dans Windows.";
                }

                return true;
            }
            catch (Exception ex)
            {
                message = "Erreur de configuration : " + ex.Message;
                return false;
            }
        }

        private static void SetRmSvcState(bool disable)
        {
            try
            {
                // 1. Configurer le registre Start (4 = Désactivé, 3 = Manuel/Demande)
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(REG_RMSVC, true))
                {
                    if (key != null)
                    {
                        key.SetValue("Start", disable ? 4 : 3, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }

            try
            {
                // 2. Réinitialiser SystemRadioState à 0 (Mode Avion inactif)
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(REG_RADIO_STATE, true))
                {
                    if (key != null)
                    {
                        key.SetValue("", 0, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }

            try
            {
                // 3. Exécuter sc.exe pour arrêter ou démarrer le service en arrière-plan
                if (disable)
                {
                    RunHiddenCommand("sc.exe", "config RmSvc start= disabled");
                    RunHiddenCommand("sc.exe", "stop RmSvc");
                }
                else
                {
                    RunHiddenCommand("sc.exe", "config RmSvc start= demand");
                    RunHiddenCommand("sc.exe", "start RmSvc");
                }
            }
            catch { }
        }

        private static void RunHiddenCommand(string fileName, string args)
        {
            try
            {
                System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo(fileName, args)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden
                };
                using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi))
                {
                    if (p != null)
                    {
                        p.WaitForExit(3000);
                    }
                }
            }
            catch { }
        }

        public static void RestartExplorer()
        {
            try
            {
                foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName("explorer"))
                {
                    try
                    {
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                    catch { }
                }

                string explorerPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
                System.Diagnostics.Process.Start(explorerPath);
            }
            catch { }
        }

        private static void CopyRegistryKey(RegistryKey sourceKey, RegistryKey destKey)
        {
            foreach (string valueName in sourceKey.GetValueNames())
            {
                object objValue = sourceKey.GetValue(valueName);
                RegistryValueKind valKind = sourceKey.GetValueKind(valueName);
                destKey.SetValue(valueName, objValue, valKind);
            }
        }

        private IntPtr AllocateNetworkList(List<NativeWlan.DOT11_NETWORK> networks)
        {
            int count = networks != null ? networks.Count : 0;
            int netSize = Marshal.SizeOf(typeof(NativeWlan.DOT11_NETWORK));
            int totalBytes = 8 + count * netSize;

            IntPtr ptr = Marshal.AllocHGlobal(totalBytes);
            Marshal.WriteInt32(ptr, 0, count); // dwNumberOfItems
            Marshal.WriteInt32(ptr, 4, 0);     // dwIndex

            for (int i = 0; i < count; i++)
            {
                IntPtr itemPtr = new IntPtr(ptr.ToInt64() + 8 + i * netSize);
                Marshal.StructureToPtr(networks[i], itemPtr, false);
            }

            return ptr;
        }
    }
}

