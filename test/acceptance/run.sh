#!/usr/bin/env bash

function run_acceptance_test() {
    build_num=$1
    runtime=$2
    echo "deploying of ${runtime} [build: ${build_num}]"
    cp -r test/acceptance/ /tmp/acceptance/
    cd /tmp/acceptance/lambda-handlers/
    npm install epsagon
    serverless deploy --runtime ${runtime} --buildNumber ${build_num} || {  echo "deployment of ${runtime} [build: ${build_num}] failed" ; result=1; }
    cd -
    TRAVIS_BUILD_NUMBER=${build_num} mocha test/acceptance/acceptance.js || {  echo "tests ${runtime} [build: ${build_num}] failed" ; result=1; }
    cd /tmp/acceptance/lambda-handlers/
    serverless remove --runtime ${runtime} --buildNumber ${build_num}
    cd -
    rm -rf /tmp/acceptance
}

build_num=$1
result=0

run_acceptance_test ${build_num} nodejs8.10
run_acceptance_test ${build_num} nodejs6.10

exit ${result}
