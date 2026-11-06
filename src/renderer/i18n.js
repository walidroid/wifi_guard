'use strict';

/**
 * Bilingual Dictionary (French Default + English)
 * Covers all UI labels, status indicators, architectural transparency notices,
 * and mandatory error/diagnostic messages.
 */
window.GUARDIAN_I18N = {
  fr: {
    appTitle: 'WiFi Lab Guardian',
    appSubtitle: 'Administration et Protection Wi-Fi pour Laboratoires Windows 10 Pro',
    navDashboard: 'Tableau de bord',
    navWifiConfig: 'Configuration Wi-Fi',
    navProtection: 'Paramètres de protection',
    navMonitoring: 'Surveillance réseau',
    navBackup: 'Sauvegarde & Restauration',
    navSystemInfo: 'Informations système',
    navAbout: 'À propos',

    // Header badges & buttons
    adminBadgeElevated: 'Session Administrateur (UAC Actif)',
    adminBadgeStandard: 'Compte Standard (Lecture seule)',
    btnElevateUac: 'Élever les privilèges (UAC)',
    themeDark: 'Thème Sombre',
    themeLight: 'Thème Clair',

    // Protection Status Indicator (Green / Orange / Red / Gray)
    statusProtected: 'Protégé',
    statusPartial: 'Protection partiellement appliquée',
    statusUnprotected: 'Non protégé',
    statusUnknown: 'État inconnu',

    // Dashboard Cards
    cardProtectionStatus: 'État actuel de la protection',
    cardWifiConnection: 'État de la connexion Wi-Fi',
    cardConnectedSsid: 'SSID connecté',
    cardAdapterName: 'Carte réseau Wi-Fi',
    cardAdapterStatus: 'État de l’adaptateur & Radio',
    cardAirplaneMode: 'État du mode avion',
    cardLastUpdate: 'Dernière mise à jour de configuration',
    cardDisconnectReason: 'Diagnostic de connexion / déconnexion',

    // Main Controls (Dashboard)
    sectionMainControls: 'Commandes principales d’administration',
    btnEnableProtection: 'Activer la protection Wi-Fi',
    btnDisableProtection: 'Désactiver la protection Wi-Fi',
    btnRestoreOriginal: 'Restaurer la configuration originale',
    btnRefreshStatus: 'Actualiser l’état du réseau',

    // Wi-Fi Configuration Tab (Feature A & B)
    wifiConfigTitle: 'Configuration du réseau Wi-Fi du laboratoire',
    wifiConfigDesc:
      'Sélectionnez le SSID autorisé du laboratoire, importez ou configurez son profil XML en connexion automatique, et bloquez tous les autres réseaux via l’API Native WLAN Windows (WlanSetFilterList).',
    labelSelectAdapter: 'Adaptateur Wi-Fi cible :',
    labelAuthorizedSsid: 'SSID autorisé du laboratoire :',
    labelProfileName: 'Nom du profil WLAN Windows :',
    btnUseCurrentNetwork: 'Utiliser le réseau actuellement connecté',
    btnImportXml: 'Importer un profil XML WLAN...',
    btnScanNetworks: 'Actualiser la liste des réseaux',
    chkAutoConnectStartup: 'Connexion automatique au démarrage de Windows (<connectionMode>auto</connectionMode>)',
    chkReconnectOnDisconnect: 'Reconnexion automatique après une déconnexion temporaire',
    chkHideBlockedNetworks:
      'Masquer les réseaux bloqués de la liste des réseaux disponibles (WlanSetAutoConfigParameter)',
    chkBlockAdhoc: 'Bloquer également tous les réseaux Ad-Hoc (IBSS)',
    noteDisconnectReality:
      'Note technique importante : Le filtrage WLAN natif (WlanSetFilterList) empêche formellement toute connexion à un autre SSID et masque les réseaux non autorisés, mais n’empêche pas techniquement un utilisateur de cliquer sur « Déconnecter » sur le réseau autorisé. C’est pourquoi le service de surveillance rétablit automatiquement la connexion lorsque la protection est active.',
    tableVisibleNetworks: 'Réseaux Wi-Fi détectés à proximité',
    colSsid: 'SSID',
    colProfile: 'Profil associé',
    colSignal: 'Signal',
    colSecurity: 'Sécurité',
    colState: 'État',
    colAction: 'Action',
    btnSelectSsid: 'Choisir ce SSID',

    // Protection Settings Tab (Feature C & D & Shared Account Security Model)
    protectionSettingsTitle: 'Restrictions système, Stratégies Windows 10 et Mode Avion',
    protectionDistinctionTitle:
      'Distinction stricte : Restriction réelle du service vs Masquage d’interface graphique',
    enforcedSectionTitle: '1. Restrictions réellement appliquées par le service système (WlanSvc / Noyau)',
    enforcedItem1:
      'Liste blanche et liste noire WLAN (WlanSetFilterList) : Appliquées directement par le service WLAN AutoConfig pour tous les utilisateurs du poste.',
    enforcedItem2:
      'Masquage des réseaux refusés (WlanSetAutoConfigParameter) : Supprime les SSID bloqués de l’énumération réseau Windows.',
    chkLockUserProfiles:
      'Verrouiller la création de nouveaux profils Wi-Fi personnels (WlanSetSecuritySettings sur wlan_secure_user_profile)',
    chkAutoRestoreRadio:
      'Réactiver automatiquement la radio logicielle Wi-Fi si elle est coupée (WlanSetInterface)',

    uiHidingSectionTitle: '2. Restrictions d’interface graphique (Masquage des pages Paramètres Windows 10)',
    uiHidingNotice:
      'Attention : Masquer une page dans l’application Paramètres empêche la modification accidentelle par les élèves, mais ne constitue pas une frontière de sécurité matérielle si le compte partagé possède des droits administrateur.',
    chkHideWifiSettingsPage:
      'Masquer les pages Paramètres Wi-Fi, VPN, Proxy et Point d’accès mobile (SettingsPageVisibility)',
    chkHideAirplanePage:
      'Masquer la page Paramètres du Mode Avion (ms-settings:network-airplanemode)',
    chkNoNetSetup:
      'Activer la restriction de configuration réseau dans le Panneau de configuration (NoNetSetup)',
    btnSaveApplyPolicies: 'Enregistrer et appliquer les restrictions',

    airplaneLimitationTitle: 'Limitation documentée de Windows 10 Pro concernant le Mode Avion',
    airplaneLimitationBody:
      'Windows 10 Pro ne fournit aucune API publique supportée ni aucune stratégie de groupe permettant de désactiver définitivement le mode avion matériel ou le bouton rapide du Centre de notifications pour tous les utilisateurs sans altérer des pilotes système critiques. Si le mode avion ou un interrupteur matériel coupe la radio, WiFi Lab Guardian le détecte immédiatement et affiche la cause exacte sur le tableau de bord.',

    sharedAccountTitle: 'Modèle de sécurité : Compte Windows partagé Enseignant / Élèves',
    sharedAccountBody:
      'Ce laboratoire utilisant la même session Windows pour les enseignants et les élèves, une stratégie de groupe par utilisateur ne peut pas les différencier. Toute modification dans WiFi Lab Guardian exige une élévation de privilèges Windows UAC (Administrateur). Pour une sécurité réelle, le compte de session quotidien doit être un compte Standard et l’enseignant saisit le mot de passe Administrateur lors de l’invite UAC.',

    // Monitoring Tab
    monitoringTitle: 'Surveillance en temps réel & Journaux de diagnostic',
    monitoringSubtitle:
      'Événements natifs WlanRegisterNotification (ACM / MSM) sans scrutation agressive et journal local (mots de passe Wi-Fi systématiquement masqués).',
    eventsListTitle: 'Événements réseau WLAN en direct',
    logsListTitle: 'Journal de diagnostic local (guardian.log)',

    // Backup & Restore Tab
    backupTitle: 'Sauvegarde horodatée & Restauration chirurgicale',
    backupSubtitle:
      'Avant toute modification, WiFi Lab Guardian exporte les profils WLAN, les filtres de permissions et les clés de registre. La restauration annule uniquement les modifications de l’application sans écraser les configurations préexistantes.',
    btnCreateManualBackup: 'Créer une sauvegarde maintenant',
    colBackupDate: 'Date et heure',
    colBackupFile: 'Fichier (Schéma v2)',
    colBackupType: 'Type',
    colBackupDetails: 'Éléments sauvegardés',
    btnRestoreThis: 'Restaurer cette sauvegarde',

    // System Information Tab
    sysInfoTitle: 'Informations système & Architecture native',
    sysInfoSubtitle:
      'Vérification de l’environnement Windows 10 Pro x64, du module C++ N-API et de l’isolation Electron.',

    // About Tab
    aboutTitle: 'À propos de WiFi Lab Guardian',
    aboutDescription:
      'Application de bureau professionnelle conçue pour l’administration et la sécurisation du réseau sans fil des laboratoires informatiques scolaires sous Windows 10 Pro x64.',

    // Standardized French Error & Status Messages (Section 12)
    msgAdminRequired: 'Privilèges administrateur requis.',
    msgAdapterNotFound: 'Carte Wi-Fi introuvable.',
    msgProfileNotFound: 'Profil Wi-Fi du laboratoire introuvable.',
    msgWlanUnavailable: 'Service WLAN indisponible.',
    msgFilterFailed: 'Impossible d’appliquer les filtres réseau.',
    msgRadioDisabled: 'Radio Wi-Fi désactivée.',
    msgAirplaneDetected: 'Mode avion détecté.',
    msgRestoreCompleted: 'Restauration terminée.',
    msgPartialProtection: 'Protection partiellement appliquée.'
  },

  en: {
    appTitle: 'WiFi Lab Guardian',
    appSubtitle: 'Wi-Fi Administration & Protection for Windows 10 Pro School Labs',
    navDashboard: 'Dashboard',
    navWifiConfig: 'Wi-Fi Configuration',
    navProtection: 'Protection Settings',
    navMonitoring: 'Network Monitoring',
    navBackup: 'Backup & Restore',
    navSystemInfo: 'System Information',
    navAbout: 'About',

    adminBadgeElevated: 'Administrator Session (UAC Active)',
    adminBadgeStandard: 'Standard Account (Read-Only)',
    btnElevateUac: 'Request UAC Elevation',
    themeDark: 'Dark Theme',
    themeLight: 'Light Theme',

    statusProtected: 'Protected',
    statusPartial: 'Partially Protected',
    statusUnprotected: 'Unprotected',
    statusUnknown: 'Unknown',

    cardProtectionStatus: 'Current Protection Status',
    cardWifiConnection: 'Wi-Fi Connection Status',
    cardConnectedSsid: 'Connected SSID',
    cardAdapterName: 'Wi-Fi Adapter Name',
    cardAdapterStatus: 'Adapter & Radio Status',
    cardAirplaneMode: 'Airplane Mode Status',
    cardLastUpdate: 'Last Configuration Update',
    cardDisconnectReason: 'Connection / Disconnection Diagnosis',

    sectionMainControls: 'Main Administrative Controls',
    btnEnableProtection: 'Enable Wi-Fi Protection',
    btnDisableProtection: 'Disable Wi-Fi Protection',
    btnRestoreOriginal: 'Restore Original Configuration',
    btnRefreshStatus: 'Refresh Network Status',

    wifiConfigTitle: 'Laboratory Wi-Fi Network Configuration',
    wifiConfigDesc:
      'Select the authorized laboratory SSID, import or configure its XML profile for automatic connection, and block all other networks using the Windows Native WLAN API (WlanSetFilterList).',
    labelSelectAdapter: 'Target Wi-Fi Adapter:',
    labelAuthorizedSsid: 'Authorized Laboratory SSID:',
    labelProfileName: 'Windows WLAN Profile Name:',
    btnUseCurrentNetwork: 'Use Currently Connected Network',
    btnImportXml: 'Import WLAN XML Profile...',
    btnScanNetworks: 'Refresh Network List',
    chkAutoConnectStartup: 'Automatic connection on Windows startup (<connectionMode>auto</connectionMode>)',
    chkReconnectOnDisconnect: 'Automatic reconnection after temporary disconnection',
    chkHideBlockedNetworks:
      'Hide blocked networks from the available network list (WlanSetAutoConfigParameter)',
    chkBlockAdhoc: 'Also block all Ad-Hoc (IBSS) networks',
    noteDisconnectReality:
      'Important Technical Note: Native WLAN filtering (WlanSetFilterList) strictly prevents connecting to any other SSID and hides unauthorized networks, but does not prevent a user from clicking "Disconnect" on the allowed network. Therefore, the monitoring service automatically reconnects when protection is enabled.',
    tableVisibleNetworks: 'Detected Nearby Wi-Fi Networks',
    colSsid: 'SSID',
    colProfile: 'Associated Profile',
    colSignal: 'Signal',
    colSecurity: 'Security',
    colState: 'State',
    colAction: 'Action',
    btnSelectSsid: 'Select SSID',

    protectionSettingsTitle: 'System Restrictions, Windows 10 Policies & Airplane Mode',
    protectionDistinctionTitle:
      'Strict Distinction: Service-Level Enforcement vs. GUI Interface Hiding',
    enforcedSectionTitle: '1. Restrictions Actually Enforced by System Service (WlanSvc / Kernel)',
    enforcedItem1:
      'WLAN Permit & Deny Filter Lists (WlanSetFilterList): Enforced directly by the WLAN AutoConfig service for all users on the machine.',
    enforcedItem2:
      'Hide Denied Networks (WlanSetAutoConfigParameter): Removes blocked SSIDs from Windows network enumeration.',
    chkLockUserProfiles:
      'Lock creation of new per-user Wi-Fi profiles (WlanSetSecuritySettings on wlan_secure_user_profile)',
    chkAutoRestoreRadio:
      'Automatically re-enable software Wi-Fi radio if turned off (WlanSetInterface)',

    uiHidingSectionTitle: '2. GUI Interface Restrictions (Hiding Windows 10 Settings Pages)',
    uiHidingNotice:
      'Warning: Hiding a Settings page prevents casual modification by students, but is not a true security boundary if the shared account runs with administrator privileges.',
    chkHideWifiSettingsPage:
      'Hide Wi-Fi, VPN, Proxy, and Mobile Hotspot Settings pages (SettingsPageVisibility)',
    chkHideAirplanePage:
      'Hide Airplane Mode Settings page (ms-settings:network-airplanemode)',
    chkNoNetSetup:
      'Enable Network Setup restriction in Control Panel (NoNetSetup)',
    btnSaveApplyPolicies: 'Save and Apply Restrictions',

    airplaneLimitationTitle: 'Documented Windows 10 Pro Limitation Regarding Airplane Mode',
    airplaneLimitationBody:
      'Windows 10 Pro does not provide a supported public API or Group Policy that permanently disables hardware Airplane Mode or the Action Center quick-toggle for all users without breaking essential system radio services. When Airplane Mode or a hardware switch disables the radio, WiFi Lab Guardian detects it and reports the exact reason on the dashboard.',

    sharedAccountTitle: 'Security Model: Shared Teacher / Student Windows Account',
    sharedAccountBody:
      'Because the laboratory uses the same Windows account for teachers and students, user-scoped Group Policy cannot distinguish between them. All modifications in WiFi Lab Guardian require Windows UAC Administrator elevation. For effective security, the shared classroom login should be a Standard User account while the teacher authenticates via the Windows UAC prompt.',

    monitoringTitle: 'Real-Time Network Monitoring & Diagnostic Logs',
    monitoringSubtitle:
      'Event-driven WlanRegisterNotification (ACM / MSM) callbacks without aggressive polling, plus local diagnostic log (Wi-Fi passwords strictly redacted).',
    eventsListTitle: 'Live Native WLAN Events',
    logsListTitle: 'Local Diagnostic Log (guardian.log)',

    backupTitle: 'Timestamped Backup & Surgical Restoration',
    backupSubtitle:
      'Before applying any change, WiFi Lab Guardian exports existing WLAN profiles, filter lists, and registry states. Restoration reverses only changes made by the application without overwriting unrelated configurations.',
    btnCreateManualBackup: 'Create Backup Snapshot Now',
    colBackupDate: 'Timestamp',
    colBackupFile: 'Backup File (Schema v2)',
    colBackupType: 'Type',
    colBackupDetails: 'Saved Items',
    btnRestoreThis: 'Restore Snapshot',

    sysInfoTitle: 'System Information & Native Architecture',
    sysInfoSubtitle:
      'Verification of the Windows 10 Pro x64 environment, C++ N-API addon status, and Electron security isolation.',

    aboutTitle: 'About WiFi Lab Guardian',
    aboutDescription:
      'Professional desktop utility designed to configure and enforce Wi-Fi restrictions in school computer laboratories running Windows 10 Pro x64.',

    msgAdminRequired: 'Administrator privileges required.',
    msgAdapterNotFound: 'Wi-Fi adapter not found.',
    msgProfileNotFound: 'Laboratory Wi-Fi profile not found.',
    msgWlanUnavailable: 'WLAN service unavailable.',
    msgFilterFailed: 'Unable to apply network filters.',
    msgRadioDisabled: 'Wi-Fi radio disabled.',
    msgAirplaneDetected: 'Airplane mode detected.',
    msgRestoreCompleted: 'Restoration completed.',
    msgPartialProtection: 'Protection partially applied.'
  }
};
