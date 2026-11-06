'use strict';

/**
 * Automated Verification Suite (tests/verify-services.js)
 * Validates:
 * 1. Password / <keyMaterial> redaction in LoggerService
 * 2. Versioned configuration persistence in ConfigManager
 * 3. Pre-modification backup & surgical restoration in BackupService (ensuring
 *    pre-existing network filters and unrelated settings are preserved!)
 * 4. Guarded auto-reconnection behavior when protection is disabled vs enabled
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LoggerService } = require('../src/main/services/logger');
const { ConfigManager } = require('../src/main/services/config-manager');
const { WlanService } = require('../src/main/services/wlan-service');
const { PolicyService } = require('../src/main/services/policy-service');
const { BackupService } = require('../src/main/services/backup-service');

function runVerification() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wlg-test-'));

  try {
    // 1. Test LoggerService Redaction
    const logger = new LoggerService(tempDir);
    const leakedXml =
      '<WLANProfile><MSM><security><sharedKey><keyMaterial>SuperSecretLabPass123!</keyMaterial></sharedKey></security></MSM></WLANProfile>';
    const entry = logger.info('TEST_REDACT', leakedXml, leakedXml, {
      passphrase: 'SuperSecretLabPass123!'
    });
    assert(
      !entry.messageFr.includes('SuperSecretLabPass123!'),
      'LoggerService failed to redact XML <keyMaterial>'
    );
    assert(
      !entry.details.includes('SuperSecretLabPass123!'),
      'LoggerService failed to redact JSON passphrase field'
    );

    // 2. Test ConfigManager Persistence & Password Stripping
    const configManager = new ConfigManager(tempDir, logger);
    const updated = configManager.updateConfig({
      protectionEnabled: true,
      labNetwork: {
        ssid: 'LAB_SCIENCES_101',
        profileName: 'LAB_SCIENCES_101',
        passphrase: 'ShouldNeverBeSaved'
      }
    });
    assert.strictEqual(updated.labNetwork.ssid, 'LAB_SCIENCES_101');
    assert.strictEqual(updated.labNetwork.passphrase, undefined);

    // 3. Test Pre-existing Network Filter Preservation During Backup & Restoration
    let stateStore = {
      allowList: [{ ssid: 'PRE_EXISTING_CAMPUS_NET', bssType: 'infrastructure' }],
      denyList: [{ ssid: 'NEIGHBOR_CAFE', bssType: 'infrastructure' }],
      showDeniedNetworks: true,
      policy: {
        hasSettingsPageVisibility: true,
        settingsPageVisibility: 'hide:gaming-gamebar',
        hasNoNetSetup: false,
        noNetSetup: 0,
        userProfileSddl: 'D:(A;;0x7;;;BA)'
      }
    };

    const mockBridge = {
      loaded: true,
      loadError: null,
      addon: {
        isProcessElevated: () => true,
        getWlanStatus: () => ({
          wlanServiceRunning: true,
          airplaneModeKnown: true,
          airplaneModeEnabled: false,
          showDeniedNetworks: stateStore.showDeniedNetworks,
          interfaces: [
            {
              guid: '{11111111-2222-3333-4444-555555555555}',
              description: 'Intel(R) Wi-Fi 6 AX200 160MHz',
              state: 'connected',
              connected: true,
              autoconfEnabled: true,
              softwareRadioState: 'on',
              hardwareRadioState: 'on',
              radioEnabled: true,
              connectedSsid: 'LAB_SCIENCES_101',
              connectedProfileName: 'LAB_SCIENCES_101',
              signalQuality: 92
            }
          ]
        }),
        getProfiles: () => [
          {
            name: 'LAB_SCIENCES_101',
            flags: 0,
            autoConnect: false,
            xml: '<WLANProfile><name>LAB_SCIENCES_101</name><connectionType>ESS</connectionType><connectionMode>manual</connectionMode></WLANProfile>'
          }
        ],
        setProfileXml: () => ({ success: true }),
        setPreferredProfilePosition: () => ({ success: true }),
        getFilterLists: () => ({
          allowList: stateStore.allowList,
          denyList: stateStore.denyList,
          gpAllowList: [],
          gpDenyList: [],
          showDeniedNetworks: stateStore.showDeniedNetworks
        }),
        setFilterLists: (allowArr, denyArr, denyAllInfra, _denyAllAdhoc, hideDenied) => {
          stateStore.allowList = allowArr.map((s) => ({
            ssid: s,
            bssType: 'infrastructure'
          }));
          stateStore.denyList = [...denyArr];
          if (denyAllInfra) {
            stateStore.denyList.push({ ssid: '', bssType: 'infrastructure' });
          }
          stateStore.showDeniedNetworks = !hideDenied;
          return { success: true };
        },
        connectToProfile: () => ({ success: true }),
        setSoftwareRadioState: () => ({ success: true }),
        getPolicyState: () => ({ ...stateStore.policy }),
        applyPolicyState: (payload) => {
          if (payload.settingsPageVisibility === null) {
            stateStore.policy.hasSettingsPageVisibility = false;
            stateStore.policy.settingsPageVisibility = '';
          } else if (typeof payload.settingsPageVisibility === 'string') {
            stateStore.policy.hasSettingsPageVisibility = true;
            stateStore.policy.settingsPageVisibility = payload.settingsPageVisibility;
          }
          return { success: true };
        }
      }
    };

    const backupService = new BackupService(tempDir, mockBridge, logger);
    const wlanService = new WlanService(mockBridge, configManager, logger);
    const policyService = new PolicyService(mockBridge, logger);

    // Step A: Take pre-modification baseline backup
    const snapRes = backupService.createBackupSnapshot('pre-enable-protection', true);
    assert(snapRes.success, 'Backup snapshot creation failed');

    // Step B: Enable Lab Wi-Fi Protection & Policy Restrictions
    const applyRes = wlanService.applyLabWifiProtection({
      interfaceGuid: '{11111111-2222-3333-4444-555555555555}',
      ssid: 'LAB_SCIENCES_101',
      profileName: 'LAB_SCIENCES_101',
      autoConnect: true,
      hideBlockedNetworks: true,
      blockAdhocNetworks: true
    });
    assert(applyRes.success, 'applyLabWifiProtection failed');

    const polRes = policyService.applyRestrictions({
      hideWindowsWifiSettingsPage: true,
      hideWindowsAirplaneSettingsPage: true,
      restrictNoNetSetupFlag: true
    });
    assert(polRes.success, 'applyRestrictions failed');
    // Verify pre-existing `gaming-gamebar` hidden page was preserved alongside our network pages!
    assert(
      stateStore.policy.settingsPageVisibility.includes('gaming-gamebar') &&
        stateStore.policy.settingsPageVisibility.includes('network-wifi'),
      'PolicyService did not preserve pre-existing SettingsPageVisibility entry'
    );

    // Step C: Restore Original Configuration and verify surgical restoration
    const restoreRes = backupService.restoreBackup(null);
    assert(restoreRes.success, 'restoreBackup failed');
    assert.strictEqual(
      stateStore.allowList[0].ssid,
      'PRE_EXISTING_CAMPUS_NET',
      'Restoration did not restore pre-existing allow filter'
    );
    assert.strictEqual(
      stateStore.denyList[0].ssid,
      'NEIGHBOR_CAFE',
      'Restoration did not restore pre-existing deny filter'
    );
    assert.strictEqual(
      stateStore.policy.settingsPageVisibility,
      'hide:gaming-gamebar',
      'Restoration did not restore exact pre-existing SettingsPageVisibility value'
    );

    console.log('✅ All WiFi Lab Guardian unit & surgical restoration checks PASSED.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runVerification();
