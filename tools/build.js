'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Refuse to replace the preview bundle if any shipped level lacks a legal win.
require('./verify-levels').assertCampaignSolvable();
const modules = {};
function add(filename) {
  const id = path.relative(root, filename).replace(/\\/g, '/');
  if (modules[id]) return id;
  let source = fs.readFileSync(filename, 'utf8');
  modules[id] = 'pending';
  source = source.replace(/require\(['"](\.[^'"]+)['"]\)/g, (_, relative) => {
    const file = path.resolve(path.dirname(filename), relative + (path.extname(relative) ? '' : '.js'));
    return '__require(' + JSON.stringify(add(file)) + ')';
  });
  modules[id] = source;
  return id;
}
const entry = add(path.join(root, 'src', 'main.js'));
const bundle = '(function(){"use strict";var cache={};var modules={\n' +
  Object.entries(modules).map(([id, source]) => JSON.stringify(id) + ':function(module,exports,__require){\n' + source + '\n}').join(',\n') +
  '\n};function __require(id){if(cache[id])return cache[id].exports;var module={exports:{}};cache[id]=module;modules[id](module,module.exports,__require);return module.exports;}__require(' + JSON.stringify(entry) + ');})();\n';
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'bundle.js'), bundle);
console.log('Browser preview built: ' + Buffer.byteLength(bundle) + ' bytes; native game uses src directly.');
