# WiFi Lab Guardian (Documentation Française)

Application de bureau Windows 10 Pro (x64) destinée aux enseignants et administrateurs de laboratoires informatiques scolaires. **WiFi Lab Guardian** permet de restreindre l’accès Wi-Fi au seul réseau autorisé du laboratoire, de configurer la reconnexion automatique et de protéger les paramètres réseau via une interface graphique moderne inspirée de Fluent Design — **sans aucune exécution de PowerShell, CMD ou script externe**.

## 1. Architecture Technique & API Natives Windows 10 Pro

L’application repose sur une architecture modulaire hybride ultra-légère :
- **GUI Desktop Windows Native (C# .NET WinForms ~43 Ko)** : Shell de contrôle compilé via `csc.exe`, avec intégration complète dans la zone de notification Windows (System Tray), contrôle du cycle de vie sans fenêtre console/DOS noire, et élévation UAC native (`requireAdministrator`).
- **Backend Local Hors-Ligne (Node.js Express REST & SSE ~4 Mo)** : Serveur local autonome appelant le module natif C++ (`native/wlan_native.cc` compilé en N-API `wlan_native.node`) qui invoque directement les bibliothèques système Windows (`wlanapi.dll`, `advapi32.dll`, `userenv.dll`, `shell32.dll`).
- **Frontend Moderne (HTML5, Modern CSS3, Vanilla JS ~216 Ko)** : Interface adaptative et accessible via tout navigateur ou WebView local, 100% hors-ligne.
- **Installateur Standalone Unique (~19 Mo)** : Généré avec **Inno Setup 6** en compression solide `lzma2/ultra64` embarquant `node.exe` v20 pour fonctionner sur tout PC cible sans dépendance préalable.

| Fonctionnalité | API Win32 / Native C++ utilisée | Rôle technique exact |
| :--- | :--- | :--- |
| **Énumération & État WLAN** | `WlanOpenHandle`, `WlanEnumInterfaces`, `WlanQueryInterface` ([Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/)) | Détecte les cartes Wi-Fi actives, le SSID connecté, la qualité du signal et l’état du service `WlanSvc`. |
| **Filtrage SSID (Autoriser / Bloquer)** | [WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist) & [WlanGetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlangetfilterlist) | Configure la liste blanche (`wlan_filter_list_type_user_permit`) sur le SSID du laboratoire et la liste noire (`wlan_filter_list_type_user_deny`) pour bloquer tous les autres réseaux. |
| **Masquage des réseaux bloqués** | [WlanSetAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetautoconfigparameter) & [WlanQueryAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanqueryautoconfigparameter) | Applique l’opcode `wlan_autoconf_opcode_show_denied_networks` (`FALSE`) pour masquer les réseaux refusés de la liste des réseaux disponibles sous Windows. |
| **Profils & Connexion automatique** | `WlanGetProfile`, `WlanSetProfile`, `WlanSetProfilePosition`, [WlanConnect](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanconnect) | Configure `<connectionMode>auto</connectionMode>`, place le profil du laboratoire en priorité 0 et déclenche la connexion. |
| **Verrouillage DACL des profils** | [WlanSetSecuritySettings](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetsecuritysettings) & [WlanGetSecuritySettings](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlangetsecuritysettings) | Modifie le descripteur SDDL de l’objet sécurisable [WLAN_SECURABLE_OBJECT](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ne-wlanapi-wlan_securable_object) (`wlan_secure_add_new_per_user_profiles`) afin d’interdire la création de profils personnels par des utilisateurs non-administrateurs. |
| **Gestion de l’état Radio Wi-Fi** | [WlanSetInterface](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetinterface), [WLAN_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_radio_state), [WLAN_PHY_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_phy_radio_state) | Distingue l’état radio logiciel (`dot11SoftwareRadioState`) de l’état radio matériel (`dot11HardwareRadioState`) et rétablit la radio logicielle si elle est désactivée. |
| **Surveillance événementielle** | `WlanRegisterNotification` ([Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/)) | Écoute en temps réel les événements `WLAN_NOTIFICATION_SOURCE_ACM` et `WLAN_NOTIFICATION_SOURCE_MSM` via `Napi::ThreadSafeFunction` sans scrutation agressive. |
| **Stratégies Windows 10 & Registre** | `RegCreateKeyExW`, `RegSetValueExW`, `RefreshPolicyEx`, [IGroupPolicyObject](https://learn.microsoft.com/en-us/windows/win32/api/gpedit/nn-gpedit-igrouppolicyobject) | Configure la politique [SettingsPageVisibility](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-settings) (`hide:network-wifi;network-airplanemode;...`) et `NoNetSetup`. |

## 2. Distinction entre Restriction Réelle et Masquage d’Interface (Transparence Architecturale)

1. **Restrictions réellement appliquées par le service système (`WlanSvc`)** :
   - Les filtres [WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist) et le masquage [WlanSetAutoConfigParameter](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetautoconfigparameter) sont appliqués au niveau du service système Windows WLAN AutoConfig pour tous les utilisateurs du poste.
   - **Réalité sur la déconnexion manuelle** : Bloquer les autres réseaux via [WlanSetFilterList](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetfilterlist) interdit toute connexion à un réseau tiers (ex. partage de connexion mobile d’un élève), mais n’empêche pas techniquement un utilisateur de cliquer sur « Déconnecter » sur le réseau autorisé. C’est pourquoi le service de surveillance (`MonitoringService`) intercepte l’événement `wlan_notification_acm_disconnected` et relance automatiquement [WlanConnect](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlanconnect) uniquement lorsque la protection est activée.
2. **Masquage d’interface graphique (`SettingsPageVisibility`)** :
   - La valeur de registre [SettingsPageVisibility](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-settings) masque les pages `ms-settings:network-wifi` et `ms-settings:network-airplanemode` dans l’application Paramètres de Windows 10.
   - Ce masquage protège contre les manipulations accidentelles mais ne remplace pas les privilèges administrateur Windows UAC.
3. **Limitation documentée de Windows 10 Pro sur le Mode Avion** :
   - Conformément à la documentation de [WLAN_PHY_RADIO_STATE](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/ns-wlanapi-wlan_phy_radio_state), l’état radio matériel (`dot11HardwareRadioState`) ne peut pas être modifié par logiciel via [WlanSetInterface](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/nf-wlanapi-wlansetinterface). Windows 10 Pro ne fournit aucune API supportée permettant de bloquer définitivement le bouton matériel du mode avion pour tous les utilisateurs. L’application détecte immédiatement le mode avion (`SystemRadioState` et `dot11HardwareRadioState`) et affiche la cause exacte dans le tableau de bord.
4. **Modèle de sécurité sur compte Windows partagé** :
   - Lorsque l’enseignant et les élèves partagent le même compte Windows, les stratégies par utilisateur ne peuvent pas les distinguer. Toutes les opérations d’administration dans **WiFi Lab Guardian** exigent une élévation **Windows UAC** (`ShellExecuteExW` avec le verbe `runas` et vérification `GetTokenInformation(TokenElevation)`). Aucun faux système de mot de passe interne n’est utilisé.

## 3. Distribution & Installateur Standalone (~19 Mo)

Le livrable final est compilé via **Inno Setup 6** avec compression solide `lzma2/ultra64` (`WiFi-Lab-Guardian-Setup-1.0.0.exe`) :
- **Taille ultra-réduite (~19 Mo)** : En éliminant le moteur Chromium lourd (~70 Mo) au profit du shell Windows natif C# WinForms (~43 Ko) et du serveur Node.js compressé, l'empreinte mémoire et disque est drastiquement réduite.
- **Fonctionnement 100% autonome** : L'installateur embarque le runtime `bin\node.exe` (v20 x64) et le module C++ compilé `wlan_native.node`. L'application fonctionne immédiatement sur tout poste Windows 10/11 sans nécessiter d'installation préalable de Node.js, Python ou d'accès Internet.
- **Persistance & Sauvegardes** : La configuration persistante (`config.v2.json`), les sauvegardes réseau (`backups/`) et les journaux d'audit (`logs/guardian.log`) sont stockés de manière sécurisée dans `%APPDATA%\WiFiLabGuardian`.

## 4. Compilation Locale et CI/CD GitHub Actions

Le workflow `.github/workflows/build.yml` compile automatiquement l'addon C++ natif avec `node-gyp`, compile `WiFiLabGuardian.exe` avec `csc.exe`, et génère l'installateur autonome Inno Setup :

```cmd
npm install --ignore-scripts
npx node-gyp rebuild --arch=x64
node tests/verify-services.js
powershell -ExecutionPolicy Bypass -File .\build-gui.ps1
iscc installer.iss
```
