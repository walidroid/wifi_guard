'use strict';

const fs = require('fs');
const path = require('path');

const BACKUP_SCHEMA_VERSION = 2;

/**
 * Backup & Surgical Restoration Service (src/main/services/backup-service.js)
 *
 * Captures a timestamped, versioned snapshot BEFORE applying modifications:
 *   - Existing WLAN profiles (with XML) on the target adapter
 *   - Original WLAN user permit & deny filter lists (`WlanGetFilterList`)
 *   - Original `wlan_autoconf_opcode_show_denied_networks` boolean state
 *   - Original Windows Registry values (`SettingsPageVisibility`, `NoNetSetup`)
 *   - Original `wlan_secure_user_profile` SDDL string
 *   - Original software radio state
 *
 * Surgical Restoration Rule:
 *   Restoration reverses ONLY the changes applied by WiFi Lab Guardian and preserves
 *   any pre-existing network restrictions or unrelated profiles that existed prior to
 *   enabling protection.
 */
class BackupService {
  constructor(userDataDir, nativeBridge, logger) {
    this.backupDir = path.join(userDataDir, 'backups');
    this.baselineFile = path.join(this.backupDir, 'baseline-snapshot.v2.json');
    this.nativeBridge = nativeBridge;
    this.addon = nativeBridge.addon;
    this.logger = logger;
    this._ensureDirectory();
  }

  _ensureDirectory() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (_) {
      // Ignore directory creation errors if read-only
    }
  }

  /**
   * Captures a full state snapshot before applying protection.
   * If a baseline snapshot does not yet exist, saves it as the canonical baseline
   * so repeated "Enable Protection" clicks never overwrite the true original state!
   */
  createBackupSnapshot(reason = 'pre-protection', preserveExistingBaseline = true) {
    const wlanStatus = this.addon.getWlanStatus();
    const primaryInterface =
      wlanStatus.interfaces && wlanStatus.interfaces[0] ? wlanStatus.interfaces[0] : null;
    const interfaceGuid = primaryInterface ? primaryInterface.guid : '';

    const profiles = interfaceGuid ? this.addon.getProfiles(interfaceGuid) : [];
    const filters = this.addon.getFilterLists();
    const policy = this.addon.getPolicyState();

    const snapshot = {
      backupSchemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      reason,
      adapter: primaryInterface
        ? {
            guid: primaryInterface.guid,
            description: primaryInterface.description,
            softwareRadioState: primaryInterface.softwareRadioState,
            connectedSsid: primaryInterface.connectedSsid,
            connectedProfileName: primaryInterface.connectedProfileName
          }
        : null,
      filters: {
        allowList: filters.allowList || [],
        denyList: filters.denyList || [],
        showDeniedNetworks:
          typeof filters.showDeniedNetworks === 'boolean' ? filters.showDeniedNetworks : true
      },
      policy: {
        hasSettingsPageVisibility: Boolean(policy.hasSettingsPageVisibility),
        settingsPageVisibility: policy.settingsPageVisibility || '',
        hasNoNetSetup: Boolean(policy.hasNoNetSetup),
        noNetSetup: policy.noNetSetup || 0,
        userProfileSddl: policy.userProfileSddl || ''
      },
      profiles: profiles.map((p) => ({
        name: p.name,
        flags: p.flags,
        autoConnect: p.autoConnect,
        xml: p.xml
      }))
    };

    const stamp = snapshot.createdAt.replace(/[:.]/g, '-');
    const historyFile = path.join(this.backupDir, `backup-${stamp}.v2.json`);

    try {
      fs.writeFileSync(historyFile, JSON.stringify(snapshot, null, 2), 'utf8');
      if (!preserveExistingBaseline || !fs.existsSync(this.baselineFile)) {
        fs.writeFileSync(this.baselineFile, JSON.stringify(snapshot, null, 2), 'utf8');
      }
      this.logger.info(
        'BACKUP_CREATED',
        'Sauvegarde de la configuration originale effectuée avec succès.',
        'Original configuration backup created successfully.',
        { file: path.basename(historyFile), profilesCount: snapshot.profiles.length }
      );
      return {
        success: true,
        fileName: path.basename(historyFile),
        createdAt: snapshot.createdAt
      };
    } catch (err) {
      this.logger.error(
        'BACKUP_WRITE_FAILED',
        'Erreur lors de la création de la sauvegarde de configuration.',
        'Error creating configuration backup.',
        { error: err.message }
      );
      return {
        success: false,
        errorMessage: err.message
      };
    }
  }

  /**
   * Lists all available timestamped backups (sanitizing XML keyMaterial before returning to UI).
   */
  listBackups() {
    this._ensureDirectory();
    try {
      const files = fs
        .readdirSync(this.backupDir)
        .filter((f) => f.endsWith('.v2.json'))
        .sort()
        .reverse();

      return files.map((fileName) => {
        const fullPath = path.join(this.backupDir, fileName);
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        return {
          fileName,
          isBaseline: fileName === path.basename(this.baselineFile),
          backupSchemaVersion: raw.backupSchemaVersion,
          createdAt: raw.createdAt,
          reason: raw.reason,
          adapterName: raw.adapter ? raw.adapter.description : 'N/A',
          profilesCount: Array.isArray(raw.profiles) ? raw.profiles.length : 0,
          allowFilterCount:
            raw.filters && Array.isArray(raw.filters.allowList)
              ? raw.filters.allowList.length
              : 0,
          denyFilterCount:
            raw.filters && Array.isArray(raw.filters.denyList)
              ? raw.filters.denyList.length
              : 0,
          hadPreExistingSettingsPolicy: Boolean(
            raw.policy && raw.policy.hasSettingsPageVisibility
          )
        };
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Surgically restores the original configuration from the baseline (or specified backup file).
   * Reverses ONLY changes made by the application and preserves pre-existing filters/policies.
   */
  restoreBackup(targetFileName = null) {
    if (!this.addon.isProcessElevated()) {
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis pour restaurer la configuration.',
        messageEn: 'Administrator privileges required to restore configuration.'
      };
    }

    const fileToLoad = targetFileName
      ? path.join(this.backupDir, path.basename(targetFileName))
      : this.baselineFile;

    if (!fs.existsSync(fileToLoad)) {
      this.logger.warn(
        'BACKUP_NOT_FOUND',
        'Aucune sauvegarde originale trouvée ; réinitialisation chirurgicale des filtres appliqués.',
        'No baseline backup found; performing surgical reset of applied filters.'
      );
      // Even if no backup file exists, clear our filters and SettingsPageVisibility cleanly
      this.addon.setFilterLists([], [], false, false, false);
      this.addon.applyPolicyState({
        settingsPageVisibility: null,
        noNetSetup: null
      });
      return {
        success: true,
        restoredFromBaseline: false,
        messageFr: 'Restauration terminée (filtres par défaut rétablis).',
        messageEn: 'Restoration completed (default filters restored).'
      };
    }

    try {
      const snapshot = JSON.parse(fs.readFileSync(fileToLoad, 'utf8'));
      const wlanStatus = this.addon.getWlanStatus();
      const iface =
        (wlanStatus.interfaces || []).find(
          (i) => snapshot.adapter && i.guid === snapshot.adapter.guid
        ) || (wlanStatus.interfaces || [])[0];

      // 1. Restore pre-existing WLAN Permit & Deny Filter lists + ShowDeniedNetworks flag
      const origAllow = (snapshot.filters && snapshot.filters.allowList
        ? snapshot.filters.allowList
        : []
      ).map((item) => (typeof item === 'string' ? item : item.ssid));

      const origDeny =
        snapshot.filters && Array.isArray(snapshot.filters.denyList)
          ? snapshot.filters.denyList
          : [];

      const hideDenied =
        snapshot.filters && typeof snapshot.filters.showDeniedNetworks === 'boolean'
          ? !snapshot.filters.showDeniedNetworks
          : false;

      const filterRes = this.addon.setFilterLists(
        origAllow,
        origDeny,
        false,
        false,
        hideDenied
      );

      // 2. Restore original WLAN profiles that were modified
      if (iface && Array.isArray(snapshot.profiles)) {
        for (const idx of snapshot.profiles.keys()) {
          const prof = snapshot.profiles[idx];
          if (prof.xml) {
            this.addon.setProfileXml(iface.guid, prof.xml);
            this.addon.setPreferredProfilePosition(iface.guid, prof.name, idx);
          }
        }
      }

      // 3. Restore original Registry & Policy values without clobbering pre-existing settings
      const policyRestorePayload = {
        settingsPageVisibility:
          snapshot.policy && snapshot.policy.hasSettingsPageVisibility
            ? snapshot.policy.settingsPageVisibility
            : null,
        noNetSetup:
          snapshot.policy && snapshot.policy.hasNoNetSetup
            ? snapshot.policy.noNetSetup
            : null
      };
      if (snapshot.policy && snapshot.policy.userProfileSddl) {
        policyRestorePayload.userProfileSddl = snapshot.policy.userProfileSddl;
      }
      const policyRes = this.addon.applyPolicyState(policyRestorePayload);

      // 4. Delete the baseline snapshot if we restored from baseline so the next enable captures a fresh baseline
      if (fileToLoad === this.baselineFile && fs.existsSync(this.baselineFile)) {
        fs.unlinkSync(this.baselineFile);
      }

      this.logger.info(
        'RESTORATION_COMPLETED',
        'Restauration terminée avec succès à partir de la sauvegarde.',
        'Restoration completed successfully from backup.',
        { file: path.basename(fileToLoad), filterSuccess: filterRes.success, policySuccess: policyRes.success }
      );

      return {
        success: true,
        restoredFromBaseline: true,
        fileName: path.basename(fileToLoad),
        messageFr: 'Restauration terminée.',
        messageEn: 'Restoration completed.'
      };
    } catch (err) {
      this.logger.error(
        'RESTORE_ERROR',
        'Erreur lors de la restauration de la configuration originale.',
        'Error restoring original configuration.',
        { error: err.message }
      );
      return {
        success: false,
        code: 'RESTORE_ERROR',
        messageFr: `Erreur lors de la restauration : ${err.message}`,
        messageEn: `Restoration error: ${err.message}`
      };
    }
  }
}

module.exports = { BackupService };
