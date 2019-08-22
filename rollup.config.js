import copy from 'rollup-plugin-copy';

const commonjs = require('rollup-plugin-commonjs');
const { eslint } = require('rollup-plugin-eslint');
const { terser } = require('rollup-plugin-terser');
const json = require('rollup-plugin-json');

module.exports = {
    input: 'src/index.js',
    output: {
        file: 'dist/bundle.js',
        format: 'cjs',
    },
    plugins: [
        (process.env.NODE_ENV === 'production' ? eslint({
            throwOnError: true,
            throwOnWarning: true,
        }) : null),
        commonjs({
            ignore: ['conditional-runtime-dependency'],
        }),
        json(),
        (process.env.NODE_ENV === 'production' ? terser({
            warnings: 'verbose',
            compress: {
                warnings: 'verbose',
            },
            mangle: {
                keep_fnames: true,
            },
            output: {
                beautify: false,
            },
        }) : null),
        copy({
            targets: [{
                src: 'src/index.d.ts', dest: 'dist', rename: 'bundle.d.ts',
            }],
        }),
    ],
};
