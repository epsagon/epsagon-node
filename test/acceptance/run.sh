#!/usr/bin/env bash

function cleanup() {
    echo 'cleaning up'
    cd /tmp/acceptance/lambda-handlers/
    serverless remove --runtime ${runtime} --runtimeName ${runtimeName} --buildNumber ${build_num}
    cd $INITIAL_PWD
    rm -rf /tmp/acceptance
}

trap clenaup 1 2 15

function run_acceptance_test() {
    build_num=$1
    runtime=$2
    runtimeName=$3
    echo "deploying of ${runtime} [build: ${build_num}]"
    cp -r test/acceptance/ /tmp/acceptance/
    cd /tmp/acceptance/lambda-handlers/
    npm install $INITIAL_PWD
    npm install wreck
    serverless deploy --runtime ${runtime} --runtimeName ${runtimeName} --buildNumber ${build_num} || {  echo "deployment of ${runtime} [build: ${build_num}] failed" ; result=1; }
    domain_code=`aws lambda get-policy --function-name acceptance-node-${build_num}-dev-echo | python -c "import sys, json; print(json.loads(json.loads(sys.stdin.read())['Policy'])['Statement'][0]['Condition']['ArnLike']['AWS:SourceArn'].split(':')[-1].split('/')[0])"`
    cd -
    DOMAIN_CODE=${domain_code} TRAVIS_BUILD_NUMBER=${build_num} RUNTIME=${runtime} RUNTIME_NAME=${runtimeName} mocha -t 30000 test/acceptance/acceptance.js || {  echo "tests ${runtime} [build: ${build_num}] failed" ; result=1; }
    cleanup
}

INITIAL_PWD=`pwd`
build_num=$1
result=0

run_acceptance_test ${build_num} nodejs10.x njs10
run_acceptance_test ${build_num} nodejs8.10 njs8

exit ${result}
