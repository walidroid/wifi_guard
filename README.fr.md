# WiFi Lab Guardian (Documentation Française)

Application Windows native **100% portable et autonome (~40 Ko)** destinée aux enseignants et administrateurs de laboratoires informatiques scolaires. **WiFi Lab Guardian** fonctionne sans installateur, sans serveur local et sans dépendances externes.

---

## 🚀 Fonctionnalités Clés Uniques

L'application est allégée au maximum pour se concentrer sur les deux besoins fondamentaux en salle de classe :
1. **Activer / Désactiver la Protection Wi-Fi** : Verrouille la connexion réseau sur le Wi-Fi autorisé de la salle et bloque / masque immédiatement tous les autres SSID (via les API Win32 Native WLAN `wlanapi.dll`).
2. **Masquer & Neutraliser le Bouton Mode Avion** : 
   - Supprime la tuile Mode Avion du menu réseau de la barre des tâches (`ActionCenter\Quick Actions\All`).
   - Désactive et arrête le service de gestion radio Windows (`RmSvc`) pour empêcher toute coupure du Wi-Fi par touche clavier Fn ou bascule logicielle.
   - Masque la page Mode Avion dans l'application Paramètres de Windows 10/11 (`SettingsPageVisibility`).
   - Permet de recharger l'Explorateur Windows en 1 clic pour appliquer immédiatement les changements.

---

## 🛠️ Architecture 100% Native & Portable

* **Exécutable unique (~40 Ko)** : `WiFiLabGuardian.exe` ne nécessite aucune installation. Il peut être exécuté directement depuis une clé USB ou un partage réseau.
* **Zéro Serveur / Zéro Dépendance** : Pas de Node.js, pas d'Electron, pas de navigateur, pas de processus d'arrière-plan lourd.
* **Démarrage instantané (< 0.1 s)** et consommation mémoire minimale (< 15 Mo de RAM).
* **API Natives Windows** :
  - `wlanapi.dll` : `WlanOpenHandle`, `WlanEnumInterfaces`, `WlanQueryInterface`, `WlanSetFilterList`, `WlanSetAutoConfigParameter`, `WlanSetSecuritySettings`.
  - `userenv.dll` : `RefreshPolicyEx` (rafraîchissement instantané des stratégies de groupe).
  - Registre Windows : `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\SettingsPageVisibility`.

---

## 🔨 Compilation

Exécutez dans PowerShell :
```powershell
.\build-gui.ps1
```
ou double-cliquez sur `build.bat`. Le fichier binaire `WiFiLabGuardian.exe` est généré immédiatement par le compilateur C# natif de Windows (`csc.exe`).
