'use strict';

const path = require('node:path');
const pet = require('./pets/orange-cat/pet.json');

// Package only artwork referenced by the approved orange-cat pack.
const referencedArt = new Set([
  ...Object.values(pet.states).flatMap((state) => state.frames),
  pet.play.ballImage
].map((filename) => path.posix.normalize(path.posix.join('pets/orange-cat', filename))));

module.exports = {
  appId: 'app.desktopbuddy',
  productName: 'Desktop Buddy',
  directories: { output: 'dist', buildResources: 'build' },
  electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist'),
  files: ['package.json', 'src/**/*', 'pets/orange-cat/pet.json', ...referencedArt],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'Desktop-Buddy-Setup-${version}-x64.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    createStartMenuShortcut: true,
    createDesktopShortcut: true,
    deleteAppDataOnUninstall: false,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico'
  }
};
