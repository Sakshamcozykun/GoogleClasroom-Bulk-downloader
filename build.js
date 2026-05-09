const fs = require("fs");
const path = require("path");

const target = process.argv[2]; // chrome or firefox

if (!target) {
    console.log("❌ Specify target: chrome or firefox");
    process.exit(1);
}

const manifestPath = `manifest.${target}.json`;

if (!fs.existsSync(manifestPath)) {
    console.log("❌ Manifest not found:", manifestPath);
    process.exit(1);
}

// copy manifest
fs.copyFileSync(manifestPath, "manifest.json");

console.log(`✅ Built for ${target}`);
