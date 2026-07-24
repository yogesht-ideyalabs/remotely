#!/usr/bin/env node
// Overwrites node-pty's lib/utils.js (in a throwaway node_modules copy —
// never the real project one) so it loads its native addon via
// process.dlopen() against a `native/<name>.node` file next to the
// compiled binary, instead of require(), which Node's SEA feature blocks
// for anything other than built-in modules. See build-binary.sh for the
// full explanation.
const fs = require("fs");

const target = process.argv[2];
if (!target) {
  console.error("usage: patch-node-pty-loader.cjs <path to node-pty's lib/utils.js>");
  process.exit(1);
}

const shim = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNativeModule = exports.assign = void 0;
var path = require("path");
function assign(target) {
    var sources = [];
    for (var _i = 1; _i < arguments.length; _i++) { sources[_i - 1] = arguments[_i]; }
    sources.forEach(function (source) { return Object.keys(source).forEach(function (key) { return target[key] = source[key]; }); });
    return target;
}
exports.assign = assign;
function loadNativeModule(name) {
    var dir = path.join(path.dirname(process.execPath), "native");
    var modulePath = path.join(dir, name + ".node");
    var mod = { exports: {} };
    process.dlopen(mod, modulePath);
    return { dir: dir, module: mod.exports };
}
exports.loadNativeModule = loadNativeModule;
`;

fs.writeFileSync(target, shim);
console.log(`Patched ${target} to load native addons via process.dlopen (SEA-compatible).`);
