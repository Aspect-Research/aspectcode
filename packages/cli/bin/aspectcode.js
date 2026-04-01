#!/usr/bin/env node
'use strict';

// Suppress punycode deprecation warning from transitive dependencies
process.noDeprecation = true;

require('../dist/main.js').run();
