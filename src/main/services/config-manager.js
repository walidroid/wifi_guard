'use strict';

const fs = require('fs');
const path = require('path');

const CURRENT_CONFIG_SCHEMA_VERSION = 2;

const DEFAULT_CONFIG = {
  schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
  language: 'fr',
  theme: 'dark',
  protectionEnabled: false,
  lastUpdated: null,
  labNetwork: {
    interfaceGuid: '',
    adapterName: '',
    ssid: '',
    profileName: '',
    autoConnect: true,
    reconnectOnDisconnect: true,
    reconnectDelayMs: 4000,
    hideBlockedNetworks: true,
    blockAdhocNetworks: true
  },
  restrictions: {
    hideWindowsWifiSettingsPage: true,
    hideWindowsAirplaneSettingsPage: true,
    restrictNoNetSetupFlag: true,
    lockPerUserProfileCreation: false,
    autoReEnableSoftwareRadio: true
  },
  monitoring: {
    enabled: true,
    useNativeEvents: true,
    fallbackCheckIntervalMs: 15000
  }
};

/**
 * Versioned Configuration Manager (src/main/services/config-manager.js)
 * Persists application settings in %APPDATA%/WiFiLabGuardian/config.v2.json
 * without storing plain-text Wi-Fi passwords.
 */
class ConfigManager {
  constructor(userDataDir, logger) {
    this.userDataDir = userDataDir;
    this.logger = logger;
    this.configPath = path.join(userDataDir, 'config.v2.json');
    this.config = this._loadOrInitialize();
  }

  _loadOrInitialize() {
    try {
      if (!fs.existsSync(this.userDataDir)) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      }
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return this._migrateIfNeeded(parsed);
      }
    } catch (err) {
      if (this.logger) {
        this.logger.warn(
          'CONFIG_LOAD_WARN',
          'Impossible de charger la configuration existante, réinitialisation aux valeurs par défaut.',
          'Unable to load existing configuration, resetting to defaults.',
          { error: err.message }
        );
      }
    }
    const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this._saveToDisk(fresh);
    return fresh;
  }

  _migrateIfNeeded(loaded) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...loaded,
      schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      labNetwork: {
        ...DEFAULT_CONFIG.labNetwork,
        ...(loaded.labNetwork || {})
      },
      restrictions: {
        ...DEFAULT_CONFIG.restrictions,
        ...(loaded.restrictions || {})
      },
      monitoring: {
        ...DEFAULT_CONFIG.monitoring,
        ...(loaded.monitoring || {})
      }
    };
    // Never allow password fields in persisted configuration
    if (merged.labNetwork && merged.labNetwork.passphrase) {
      delete merged.labNetwork.passphrase;
    }
    return merged;
  }

  _saveToDisk(cfg) {
    try {
      const safeCopy = JSON.parse(JSON.stringify(cfg));
      if (safeCopy.labNetwork && safeCopy.labNetwork.passphrase) {
        delete safeCopy.labNetwork.passphrase;
      }
      fs.writeFileSync(this.configPath, JSON.stringify(safeCopy, null, 2), 'utf8');
      return true;
    } catch (err) {
      if (this.logger) {
        this.logger.error(
          'CONFIG_SAVE_ERROR',
          'Erreur lors de la sauvegarde du fichier de configuration.',
          'Error saving configuration file.',
          { error: err.message }
        );
      }
      return false;
    }
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  updateConfig(partial) {
    this.config = this._migrateIfNeeded({
      ...this.config,
      ...partial,
      lastUpdated: new Date().toISOString()
    });
    this._saveToDisk(this.config);
    return this.getConfig();
  }

  getConfigFilePath() {
    return this.configPath;
  }
}

module.exports = { ConfigManager, CURRENT_CONFIG_SCHEMA_VERSION };
