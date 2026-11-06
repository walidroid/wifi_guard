# WiFi Lab Guardian (Documentation Française)

Application de bureau Windows 10 Pro (x64) destinée aux enseignants et administrateurs de laboratoires informatiques scolaires. **WiFi Lab Guardian** permet de restreindre l’accès Wi-Fi au seul réseau autorisé du laboratoire, de configurer la reconnexion automatique et de protéger les paramètres réseau via une interface graphique moderne inspirée de Fluent Design — **sans aucune exécution de PowerShell, CMD ou script externe**.

## 1. Architecture Technique & API Natives Windows 10 Pro

L’application repose sur une architecture modulaire stricte combinant Electron et un module natif C++ (`native/wlan_native.cc`) compilé en N-API (`wlan_native.node`) qui appelle directement les bibliothèques système de Windows (`wlanapi.dll`, `advapi32.dll`, `userenv.dll`, `shell32.dll`) documentées dans l’en-tête [Wlanapi.h](https://learn.microsoft.com/en-us/windows/win32/api/wlanapi/) et la référence des [fonctions Native Wifi](https://learn.microsoft.com/en-us/windows/win32/nativewifi/native-wifi-functions) :

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

## 3. Distribution Portable (`WiFiLabGuardian.exe`) et Fichiers Accompagnateurs

Le livrable final `WiFiLabGuardian.exe` est généré via **Electron Builder** avec la cible `portable` (`x64`) :
- **Exécutable portable vs Binaire natif** : `WiFiLabGuardian.exe` est un exécutable portable autonome qui ne nécessite aucun installateur ni prérequis externe (Node.js, Python ou .NET ne sont pas requis sur les postes cibles).
- Lors de son exécution, le conteneur portable extrait automatiquement l’environnement d’exécution Electron ainsi que la bibliothèque dynamique native compilée `wlan_native.node` (située dans `resources/app.asar.unpacked/build/Release/wlan_native.node` et `resources/native/wlan_native.node`) dans son répertoire temporaire d’exécution, tandis que la configuration persistante (`config.v2.json`), les sauvegardes (`backups/`) et les journaux (`logs/guardian.log`) sont stockés proprement dans `%APPDATA%\WiFiLabGuardian`.

## 4. Compilation Locale et CI/CD GitHub Actions

Le fichier `.github/workflows/build.yml` compile automatiquement l’addon C++ et génère `WiFiLabGuardian.exe` sur un runner **Windows Server (`windows-2022`)** :

```cmd
npm install --ignore-scripts
npx node-gyp rebuild --arch=x64
npx electron-rebuild -f -w wlan_native --arch=x64
node tests/verify-services.js
npx electron-builder --config electron-builder.yml --win portable --x64
```
