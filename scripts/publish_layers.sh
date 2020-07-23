#!/usr/bin/env bash
declare -a regions=("ap-northeast-1" "ap-northeast-2" "ap-south-1" "ap-southeast-1" "ap-southeast-2" "ca-central-1" "eu-central-1" "eu-west-1" "eu-west-2" "eu-west-3" "sa-east-1" "us-east-1" "us-east-2" "us-west-1" "us-west-2")
pip install --user awscli jq
mkdir layer
cd layer
npm init -f
npm i epsagon@latest
mkdir nodejs
mv node_modules nodejs/
zip -r epsagon-node-layer.zip nodejs -x ".*" -x "__MACOSX"

for region in "${regions[@]}"
do
    echo ${region}
    aws s3 cp epsagon-node-layer.zip s3://epsagon-layers-${region}/
    LAYER_VERSION=$(aws lambda publish-layer-version --layer-name epsagon-node-layer --description "Epsagon Node.js layer that includes pre-installed packages to get up and running with monitoring and distributed tracing" --content S3Bucket=epsagon-layers-${region},S3Key=epsagon-node-layer.zip --compatible-runtimes nodejs12.x nodejs10.x nodejs8.10 --license-info MIT --region ${region} | jq '.Version')
    sleep 3
    aws lambda add-layer-version-permission --layer-name epsagon-node-layer --version-number ${LAYER_VERSION} --statement-id sid1 --action lambda:GetLayerVersion --principal \* --region ${region}
done
