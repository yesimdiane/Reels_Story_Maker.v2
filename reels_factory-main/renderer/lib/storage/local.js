// Storage adapter: local folder (Mac). A cloud adapter (GCS/Drive) implements the same publish().
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createLocalStorage({ outputDir }) {
  return {
    name: 'local',
    /** Moves a finished file into place and returns its location. */
    async publish(localFile, key) {
      const dest = path.join(outputDir, key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (path.resolve(localFile) !== path.resolve(dest)) fs.copyFileSync(localFile, dest);
      return { uri: 'file://' + dest, path: dest };
    },
    exists(key) {
      return fs.existsSync(path.join(outputDir, key));
    },
    read(key) {
      return fs.readFileSync(path.join(outputDir, key), 'utf8');
    },
  };
}

module.exports = { createLocalStorage };
