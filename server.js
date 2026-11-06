'use strict';

/**
 * WiFi Lab Guardian - Local Backend Server (server.js)
 * Standalone offline Node.js server exposing REST API & SSE for Windows WLAN Administration.
 * Zero external cloud dependencies. Operates 100% offline.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { LoggerService } = require('./src/main/services/logger');
const { ConfigManager } = require('./src/main/services/config-manager');
const { loadNativeAddon } = require('./src/main/services/native-bridge');
const { WlanService } = require('./src/main/services/wlan-service');
const { PolicyService } = require('./src/main/services/policy-service');
const { BackupService } = require('./src/main/services/backup-service');
const { MonitoringService } = require('./src/main/services/monitoring-service');

// 1. Resolve Data Directory (AppData/WiFiLabGuardian or local data/)
const defaultDataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'WiFiLabGuardian')
  : path.join(__dirname, 'data');
const userDataDir = process.env.WIFI_GUARD_DATA_DIR || defaultDataDir;

try {
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
} catch (_) {}

// 2. Instantiate Core Services
const logger = new LoggerService(userDataDir);
const configManager = new ConfigManager(userDataDir, logger);
const nativeBridge = loadNativeAddon(logger);
const wlanService = new WlanService(nativeBridge, configManager, logger);
const policyService = new PolicyService(nativeBridge, logger);
const backupService = new BackupService(userDataDir, nativeBridge, logger);
const monitoringService = new MonitoringService(
  nativeBridge,
  wlanService,
  configManager,
  logger
);

// 3. Setup Express App
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve Frontend Static Files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

function sanitizeString(val, maxLength = 256) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLength);
}

// 4. REST API Routes

// 4.1 Status & Health
app.get('/api/status', (req, res) => {
  try {
    const status = wlanService.getComprehensiveStatus();
    const isAdmin = Boolean(
      nativeBridge.loaded &&
      nativeBridge.addon &&
      typeof nativeBridge.addon.isProcessElevated === 'function' &&
      nativeBridge.addon.isProcessElevated()
    );
    res.json({
      ...status,
      isAdmin,
      nativeAddonLoaded: nativeBridge.loaded
    });
  } catch (err) {
    logger.error('API_STATUS_ERROR', 'Erreur statut API', 'API status error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 4.2 Available Networks & Profiles for an Adapter
app.get('/api/networks', (req, res) => {
  try {
    const guid = sanitizeString(req.query.interfaceGuid || '', 64);
    const data = wlanService.getNetworksAndProfiles(guid);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.3 Import Profile XML
app.post('/api/profile-xml', (req, res) => {
  try {
    const isAdmin = Boolean(
      nativeBridge.loaded &&
      nativeBridge.addon &&
      nativeBridge.addon.isProcessElevated()
    );
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis pour importer un profil XML.',
        messageEn: 'Administrator privileges required to import an XML profile.'
      });
    }

    const xmlContent = req.body.xmlContent || '';
    if (!xmlContent || !xmlContent.includes('<WLANProfile')) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_XML',
        messageFr: 'Le contenu fourni n’est pas un profil WLAN Windows valide.',
        messageEn: 'The provided content is not a valid Windows WLAN profile.'
      });
    }

    const status = wlanService.getComprehensiveStatus();
    const guid = status.primaryInterface ? status.primaryInterface.guid : '';
    if (!guid) {
      return res.status(404).json({
        success: false,
        code: 'ADAPTER_NOT_FOUND',
        messageFr: 'Carte Wi-Fi introuvable.',
        messageEn: 'Wi-Fi adapter not found.'
      });
    }

    const setRes = nativeBridge.addon.setProfileXml(guid, xmlContent);
    if (setRes.success) {
      logger.info(
        'PROFILE_XML_IMPORTED',
        'Profil Wi-Fi XML importé avec succès.',
        'Wi-Fi XML profile imported successfully.'
      );
    }
    res.json(setRes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.4 Enable Protection
app.post('/api/protection/enable', (req, res) => {
  try {
    const isAdmin = Boolean(
      nativeBridge.loaded &&
      nativeBridge.addon &&
      nativeBridge.addon.isProcessElevated()
    );
    if (!isAdmin) {
      logger.warn(
        'ENABLE_BLOCKED_NOT_ADMIN',
        'Tentative d’activation de la protection sans privilèges administrateur.',
        'Attempted to enable protection without administrator privileges.'
      );
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      });
    }

    const payload = req.body || {};
    // Step 1: Pre-modification backup
    backupService.createBackupSnapshot('pre-enable-protection', true);

    // Step 2: Merge config
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

    // Step 3: Apply WLAN Filters
    const wlanRes = wlanService.applyLabWifiProtection(nextLab);
    if (!wlanRes.success) {
      return res.json(wlanRes);
    }

    // Step 4: Apply Policy Restrictions
    const policyRes = policyService.applyRestrictions(nextRestrictions);

    // Step 5: Persist config
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

    res.json({
      success: true,
      partial: !policyRes.success,
      messageFr: policyRes.success
        ? `Protection Wi-Fi activée sur le réseau "${wlanRes.ssid}".`
        : 'Protection partiellement appliquée.',
      messageEn: policyRes.success
        ? `Wi-Fi protection enabled on network "${wlanRes.ssid}".`
        : 'Protection partially applied.',
      status: wlanService.getComprehensiveStatus()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.5 Disable Protection
app.post('/api/protection/disable', (req, res) => {
  try {
    const isAdmin = Boolean(
      nativeBridge.loaded &&
      nativeBridge.addon &&
      nativeBridge.addon.isProcessElevated()
    );
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      });
    }

    configManager.updateConfig({ protectionEnabled: false });
    const wlanRes = wlanService.disableLabWifiFilters();
    const policyRes = policyService.applyRestrictions({
      hideWindowsWifiSettingsPage: false,
      hideWindowsAirplaneSettingsPage: false,
      restrictNoNetSetupFlag: false,
      lockPerUserProfileCreation: false
    });

    res.json({
      success: wlanRes.success,
      partial: !policyRes.success,
      messageFr: 'Protection Wi-Fi désactivée.',
      messageEn: 'Wi-Fi protection disabled.',
      status: wlanService.getComprehensiveStatus()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.6 Restore Backup Snapshot
app.post('/api/restore', (req, res) => {
  try {
    const safeFile = req.body.fileName ? sanitizeString(req.body.fileName, 128) : null;
    configManager.updateConfig({ protectionEnabled: false });
    const restoreRes = backupService.restoreBackup(safeFile);
    res.json({
      ...restoreRes,
      status: wlanService.getComprehensiveStatus()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.7 Create Backup
app.post('/api/backup', (req, res) => {
  try {
    const snap = backupService.createBackupSnapshot('manual-snapshot', true);
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.8 List Backups
app.get('/api/backups', (req, res) => {
  try {
    res.json(backupService.listBackups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.9 Config Management
app.get('/api/config', (req, res) => {
  try {
    res.json(configManager.getConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const updated = configManager.updateConfig(req.body || {});
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.10 Logs & Events
app.get('/api/logs', (req, res) => {
  try {
    res.json({
      events: monitoringService.getEventsHistory(),
      logs: logger.getRecentLogs(150),
      logFilePath: logger.getLogFilePath(),
      configFilePath: configManager.getConfigFilePath()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.11 System & Architecture Info
app.get('/api/sysinfo', (req, res) => {
  try {
    const pkg = require('./package.json');
    const isAdmin = Boolean(
      nativeBridge.loaded &&
      nativeBridge.addon &&
      typeof nativeBridge.addon.isProcessElevated === 'function' &&
      nativeBridge.addon.isProcessElevated()
    );
    res.json({
      appName: pkg.productName || 'WiFi Lab Guardian',
      appVersion: pkg.version || '1.0.0',
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      osType: os.type(),
      hostname: os.hostname(),
      nodeVersion: process.versions.node,
      userDataPath: userDataDir,
      exePath: process.execPath,
      nativeAddonLoaded: nativeBridge.loaded,
      nativeBinaryPath: nativeBridge.binaryPath,
      isAdmin
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.12 Live Server-Sent Events (SSE) for Real-Time WLAN Events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onWlanEvent = (evt) => {
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch (_) {}
  };

  monitoringService.on('wlan-event', onWlanEvent);

  // Keep-alive heartbeat every 20 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (_) {}
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    monitoringService.off('wlan-event', onWlanEvent);
  });
});

// Fallback: serve index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 5. Server Startup
const DEFAULT_PORT = 4567;
const argPortIndex = process.argv.findIndex((a) => a.startsWith('--port='));
let parsedPort = DEFAULT_PORT;
if (argPortIndex !== -1) {
  const custom = parseInt(process.argv[argPortIndex].split('=')[1], 10);
  if (!isNaN(custom) && custom > 0 && custom < 65536) parsedPort = custom;
}
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : parsedPort;

const server = app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[WiFiLabGuardian] Server listening on ${url}`);
  logger.info(
    'SERVER_STARTED',
    `Serveur local démarré sur ${url}`,
    `Local server started on ${url}`,
    { port: PORT, pid: process.pid }
  );
});

function handleShutdown() {
  console.log('[WiFiLabGuardian] Shutting down gracefully...');
  monitoringService.stop();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

