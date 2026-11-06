; =====================================================================
; Script Inno Setup 6 — WiFi Lab Guardian
; Génère un Installateur Standalone Windows Unique (.exe)
; Compression Ultra LZMA2 pour une taille finale de ~19 Mo
; Embarque node.exe (v20) autonome pour fonctionner 100% hors-ligne
; sans prérequis ni dépendances sur le PC cible.
; =====================================================================

#define MyAppName "WiFi Lab Guardian"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "WiFi Lab Guardian Engineering"
#define MyAppExeName "WiFiLabGuardian.exe"

[Setup]
; Identifiant unique de l'application
AppId={{E8B7A462-8F51-4E19-9B21-889B663673F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Écran d'informations avant installation
InfoBeforeFile=info.txt
; Privilèges Administrateur requis pour les stratégies WLAN et le pare-feu
PrivilegesRequired=admin
OutputDir=dist
OutputBaseFilename=WiFi-Lab-Guardian-Setup-1.0.0
SetupIconFile=assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Exécutable C# WinForms principal (Shell Native)
Source: "WiFiLabGuardian.exe"; DestDir: "{app}"; Flags: ignoreversion

; Binaire Node.js autonome (embarqué pour exécution 100% hors-ligne)
Source: "bin\node.exe"; DestDir: "{app}\bin"; Flags: ignoreversion skipifsourcedoesntexist

; Serveur Backend Node.js
Source: "server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion

; Services Backend & Modules
Source: "src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs

; Frontend Web Application (HTML5, Modern CSS3, Vanilla JS)
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; Dépendances Node (Express, CORS, etc.)
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Module Natif C++ compilé (wlan_native.node)
Source: "build\Release\wlan_native.node"; DestDir: "{app}\build\Release"; Flags: ignoreversion skipifsourcedoesntexist
Source: "build\Release\wlan_native.node"; DestDir: "{app}\native"; Flags: ignoreversion skipifsourcedoesntexist

; Ressources visuelles & informations
Source: "assets\icon.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "assets\icon.svg"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "info.txt"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\data"; Permissions: users-full

[Icons]
Name: "{autoprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\icon.ico"
Name: "{autoprograms}\{#MyAppName}\Désinstaller {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent runascurrentuser

