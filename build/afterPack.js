'use strict';

// electron-builder afterPack hook.
// The app is built UNSIGNED (no Apple Developer account yet). On recent macOS,
// a completely unsigned app is blocked with a scary "contains malware" message
// and can't even be opened via right-click. Applying an ad-hoc signature ("-")
// gives it a valid local signature so it opens on the user's own Mac.
// This is a stopgap until real Developer-ID signing + notarization is set up.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Real Developer-ID signing + hardened runtime is now configured in
  // package.json build.mac. electron-builder performs the real signature
  // itself, so ad-hoc signing here would only get overwritten (or conflict).
  // Skip it whenever a real signing identity is set.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') {
    console.log('[afterPack] real signing configured; skipping ad-hoc sign.');
    return;
  }

  const appName = context.packager.appInfo.productFilename; // "Founders Office"
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    console.log('[afterPack] ad-hoc signature applied.');
  } catch (err) {
    // Don't fail the whole build if codesign is unavailable — just warn.
    console.warn(`[afterPack] ad-hoc signing failed: ${err.message}`);
  }
};
