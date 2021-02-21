const path = require('path');
const webpack = require('webpack');
const { ESBuildPlugin } = require('esbuild-loader');
const ZipPlugin = require('zip-webpack-plugin');

module.exports = {
  entry: './src/handler.ts',
  mode: "production",
  target: 'node',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.json']
  },
  externals: [
    'aws-sdk/clients/dynamodb'
  ],
  plugins: [
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
    new ESBuildPlugin(),
    new ZipPlugin({
      filename: `hello.zip`
    })
  ],
  output: {
    filename: 'hello.js',
    path: path.resolve(__dirname, '../resources/'),
    libraryTarget: 'commonjs2'
  }
};
