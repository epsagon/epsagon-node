#!/usr/bin/env bash
if [ `node -v | cut -d '.' -f1,2` != 'v6' ]; then
    echo "not 6"
    mocha --recursive test/unit_tests
else
    echo "6"
    mocha --recursive test/unit_tests --exclude test/unit_tests/wrappers/test_openwhisk.js
fi
