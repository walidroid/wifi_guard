'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { LoggerService } = require('./services/logger');
const { ConfigManager } = require('./services/config-manager');
const { loadNativeAddon } = require('./services/native-bridge');
const { WlanService } = require('./services/wlan-service');
const { PolicyService } = require('./services/policy-service');
const { BackupService } = require('./services/backup-service');
const { MonitoringService } = require('./services/monitoring-service');

let mainWindow = null;
let logger = null;
let configManager = null;
let nativeBridge = null;
let wlanService = null;
let policyService = null;
let backupService = null;
let monitoringService = null;

// Prevent multiple instances of WiFi Lab Guardian
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function initializeServices() {
  const userDataDir = app.getPath('userData');
  logger = new LoggerService(userDataDir);
  configManager = new ConfigManager(userDataDir, logger);
  nativeBridge = loadNativeAddon(logger);
  wlanService = new WlanService(nativeBridge, configManager, logger);
  policyService = new PolicyService(nativeBridge, logger);
  backupService = new BackupService(userDataDir, nativeBridge, logger);
  monitoringService = new MonitoringService(
    nativeBridge,
    wlanService,
    configManager,
    logger
  );

  monitoringService.on('wlan-event', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('guardian:wlan-event', evt);
    }
  });

  monitoringService.start();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'WiFi Lab Guardian',
    backgroundColor: '#0b132b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  // Block navigation and external window creation
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// =============================================================================
// Strict IPC Input Validation Helpers
// =============================================================================
function assertPlainObject(val, name) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`Invalid IPC payload for ${name}: expected object`);
  }
}

function sanitizeString(val, maxLength = 256) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLength);
}

function registerIpcHandlers() {
  // 1. Get complete dashboard & network status
  ipcMain.handle('guardian:get-status', async () => {
    return wlanService.getComprehensiveStatus();
  });

  // 2. Get available networks & profiles for a given adapter
  ipcMain.handle('guardian:get-networks', async (_event, interfaceGuid) => {
    const safeGuid = sanitizeString(interfaceGuid, 64);
    return wlanService.getNetworksAndProfiles(safeGuid);
  });

  // 3. Import a WLAN XML profile file via native dialog (no shell commands)
  ipcMain.handle('guardian:import-profile-xml', async () => {
    if (!nativeBridge.addon.isProcessElevated()) {
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis pour importer un profil XML.',
        messageEn: 'Administrator privileges required to import an XML profile.'
      };
    }

    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Importer un profil Wi-Fi XML / Import Wi-Fi Profile XML',
      filters: [{ name: 'WLAN Profile XML', extensions: ['xml'] }],
      properties: ['openFile']
    });

    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const selectedPath = res.filePaths[0];
    const xmlContent = fs.readFileSync(selectedPath, 'utf8');
    if (!xmlContent.includes('<WLANProfile')) {
      return {
        success: false,
        code: 'INVALID_XML',
        messageFr: 'Le fichier sélectionné n’est pas un profil WLAN Windows valide.',
        messageEn: 'The selected file is not a valid Windows WLAN profile.'
      };
    }

    const status = wlanService.getComprehensiveStatus();
    const guid = status.primaryInterface ? status.primaryInterface.guid : '';
    if (!guid) {
      return {
        success: false,
        code: 'ADAPTER_NOT_FOUND',
        messageFr: 'Carte Wi-Fi introuvable.',
        messageEn: 'Wi-Fi adapter not found.'
      };
    }

    const setRes = nativeBridge.addon.setProfileXml(guid, xmlContent);
    if (setRes.success) {
      logger.info(
        'PROFILE_XML_IMPORTED',
        'Profil Wi-Fi XML importé avec succès.',
        'Wi-Fi XML profile imported successfully.',
        { file: path.basename(selectedPath) }
      );
    }
    return setRes;
  });

  // 4. Enable Wi-Fi Protection (Creates backup -> Applies WLAN Filters -> Applies Policy -> Updates Config)
  ipcMain.handle('guardian:enable-protection', async (_event, payload) => {
    assertPlainObject(payload, 'enable-protection');

    if (!nativeBridge.addon.isProcessElevated()) {
      logger.warn(
        'ENABLE_BLOCKED_NOT_ADMIN',
        'Tentative d’activation de la protection sans privilèges administrateur.',
        'Attempted to enable protection without administrator privileges.'
      );
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      };
    }

    // Step 1: Mandatory pre-modification backup
    backupService.createBackupSnapshot('pre-enable-protection', true);

    // Step 2: Merge configuration
    const currentCfg = configManager.getConfig();
    const nextLab = {
      ...currentCfg.labNetwork,
      interfaceGuid: sanitizeString(
        payload.interfaceGuid || currentCfg.labNetwork.interfaceGuid,
        64
      ),
      ssid: sanitizeString(payload.ssid || currentCfg.labNetwork.ssid, 64),
      profileName: sanitizeString(
        payload.profileName || payload.ssid || currentCfg.labNetwork.profileName,
        64
      ),
      autoConnect:
        typeof payload.autoConnect === 'boolean'
          ? payload.autoConnect
          : currentCfg.labNetwork.autoConnect,
      reconnectOnDisconnect:
        typeof payload.reconnectOnDisconnect === 'boolean'
          ? payload.reconnectOnDisconnect
          : currentCfg.labNetwork.reconnectOnDisconnect,
      hideBlockedNetworks:
        typeof payload.hideBlockedNetworks === 'boolean'
          ? payload.hideBlockedNetworks
          : currentCfg.labNetwork.hideBlockedNetworks,
      blockAdhocNetworks:
        typeof payload.blockAdhocNetworks === 'boolean'
          ? payload.blockAdhocNetworks
          : currentCfg.labNetwork.blockAdhocNetworks
    };

    const nextRestrictions = {
      ...currentCfg.restrictions,
      ...(payload.restrictions || {})
    };

    // Step 3: Apply Native WLAN Filters & Auto-Connect Profile
    const wlanRes = wlanService.applyLabWifiProtection(nextLab);
    if (!wlanRes.success) {
      return wlanRes;
    }

    // Step 4: Apply Windows 10 Policies & Settings Visibility
    const policyRes = policyService.applyRestrictions(nextRestrictions);

    // Step 5: Persist configuration
    configManager.updateConfig({
      protectionEnabled: true,
      labNetwork: {
        ...nextLab,
        interfaceGuid: wlanRes.interfaceGuid,
        adapterName: wlanRes.adapterName,
        ssid: wlanRes.ssid,
        profileName: wlanRes.profileName
      },
      restrictions: nextRestrictions
    });

    return {
      success: true,
      partial: !policyRes.success,
      messageFr: policyRes.success
        ? `Protection Wi-Fi activée sur le réseau "${wlanRes.ssid}".`
        : 'Protection partiellement appliquée.',
      messageEn: policyRes.success
        ? `Wi-Fi protection enabled on network "${wlanRes.ssid}".`
        : 'Protection partially applied.',
      status: wlanService.getComprehensiveStatus()
    };
  });

  // 5. Disable Wi-Fi Protection (Stops auto-reconnect + removes WLAN filters + removes UI policies)
  ipcMain.handle('guardian:disable-protection', async () => {
    if (!nativeBridge.addon.isProcessElevated()) {
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      };
    }

    configManager.updateConfig({ protectionEnabled: false });
    const wlanRes = wlanService.disableLabWifiFilters();
    const policyRes = policyService.applyRestrictions({
      hideWindowsWifiSettingsPage: false,
      hideWindowsAirplaneSettingsPage: false,
      restrictNoNetSetupFlag: false,
      lockPerUserProfileCreation: false
    });

    return {
      success: wlanRes.success,
      partial: !policyRes.success,
      messageFr: 'Protection Wi-Fi désactivée.',
      messageEn: 'Wi-Fi protection disabled.',
      status: wlanService.getComprehensiveStatus()
    };
  });

  // 6. Restore Original Configuration from Backup
  ipcMain.handle('guardian:restore-backup', async (_event, fileName) => {
    const safeFile = fileName ? sanitizeString(fileName, 128) : null;
    configManager.updateConfig({ protectionEnabled: false });
    const restoreRes = backupService.restoreBackup(safeFile);
    return {
      ...restoreRes,
      status: wlanService.getComprehensiveStatus()
    };
  });

  // 7. Create a Manual Backup Snapshot
  ipcMain.handle('guardian:create-backup', async () => {
    return backupService.createBackupSnapshot('manual-snapshot', true);
  });

  // 8. List Backups
  ipcMain.handle('guardian:list-backups', async () => {
    return backupService.listBackups();
  });

  // 9. Update Configuration / Preferences (Language, Theme, Restrictions)
  ipcMain.handle('guardian:update-config', async (_event, partial) => {
    assertPlainObject(partial, 'update-config');
    const updated = configManager.updateConfig(partial);
    return {
      success: true,
      config: updated
    };
  });

  // 10. Request Windows UAC Elevation (Relaunches EXE via ShellExecuteExW "runas")
  ipcMain.handle('guardian:request-elevation', async () => {
    if (nativeBridge.addon.isProcessElevated()) {
      return { success: true, alreadyElevated: true };
    }
    const relRes = nativeBridge.addon.requestUacElevation('');
    if (relRes.success) {
      logger.info(
        'UAC_RELAUNCH_INITIATED',
        'Élévation UAC accordée ; relance de l’application en mode Administrateur.',
        'UAC elevation granted; relaunching application as Administrator.'
      );
      setTimeout(() => app.quit(), 300);
    }
    return relRes;
  });

  // 11. Get Monitoring Events & Diagnostic Logs
  ipcMain.handle('guardian:get-logs-and-events', async () => {
    return {
      events: monitoringService.getEventsHistory(),
      logs: logger.getRecentLogs(150),
      logFilePath: logger.getLogFilePath(),
      configFilePath: configManager.getConfigFilePath()
    };
  });

  // 12. Get System & Architecture Information
  ipcMain.handle('guardian:get-system-info', async () => {
    return {
      appName: 'WiFi Lab Guardian',
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      osType: os.type(),
      hostname: os.hostname(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      userDataPath: app.getPath('userData'),
      exePath: app.getPath('exe'),
      nativeAddonLoaded: nativeBridge.loaded,
      nativeBinaryPath: nativeBridge.binaryPath,
      isAdmin: Boolean(nativeBridge.addon.isProcessElevated())
    };
  });
}

app.whenReady().then(() => {
  initializeServices();
  registerIpcHandlers();
  createMainWindow();

  app.on(' second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (monitoringService) {
    monitoringService.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
