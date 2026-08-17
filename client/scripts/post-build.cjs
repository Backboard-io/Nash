const fs = require('fs-extra');

// Files copied verbatim keep STABLE URLs across deploys, so the server must
// serve them with revalidation (no-cache), never immutable. The server can't
// tell hashed bundles from copied files by name, so this script — the thing
// doing the copying — declares them in dist/asset-manifest.json, read once
// at boot by api/app.py::_copied_asset_paths.
async function listFilesRecursive(dir, prefix) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(`${dir}/${entry.name}`, rel)));
    } else {
      files.push(rel);
    }
  }
  return files;
}

async function postBuild() {
  try {
    await fs.copy('public/assets', 'dist/assets');
    await fs.copy('public/robots.txt', 'dist/robots.txt');
    // AudioWorklet processor for the realtime voice PCM capture. Must be
    // a separately-fetched JS file (not bundled) so the browser's worklet
    // loader can register it via `audioWorklet.addModule()`.
    await fs.copy('public/audio-worklet-pcm.js', 'dist/audio-worklet-pcm.js');

    const copiedAssets = (await listFilesRecursive('public/assets', 'assets')).sort();
    await fs.writeJson('dist/asset-manifest.json', copiedAssets);
    console.log(
      `✅ PWA icons, robots.txt, audio worklet copied; asset-manifest.json lists ${copiedAssets.length} stable-URL assets.`,
    );
  } catch (err) {
    console.error('❌ Error copying files:', err);
    process.exit(1);
  }
}

postBuild();
