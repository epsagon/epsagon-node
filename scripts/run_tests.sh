#!/usr/bin/env bash
if [[ `node -v | cut -d '.' -f1` =~ ^(v6|v8)$ ]]; then
    mocha --recursive test/unit_tests --exclude test/unit_tests/wrappers/test_openwhisk.js --exclude test/unit_tests/wrappers/test_openwhisk_traces.js
else
    mocha --recursive test/unit_tests
fi
