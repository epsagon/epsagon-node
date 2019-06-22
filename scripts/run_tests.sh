#!/usr/bin/env bash
if [ `node -v | cut -d '.' -f1` != 'v6' ]; then
    mocha --recursive test/unit_tests
else
    mocha --recursive test/unit_tests --exclude test/unit_tests/wrappers/test_openwhisk.js
fi
