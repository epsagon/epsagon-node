import copy from 'rollup-plugin-copy';

const commonjs = require('@rollup/plugin-commonjs');
const { eslint } = require('rollup-plugin-eslint');
const { terser } = require('rollup-plugin-terser');
const json = require('@rollup/plugin-json');
const replace = require('@rollup/plugin-replace')


const commonJsDisableRequireFunc = `function commonjsRequire () {
\tthrow new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
}
`
const replacedRequire = 'var commonjsRequire = require;'
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
        commonjs(),
        replace({
            [commonJsDisableRequireFunc]: replacedRequire,
            delimiters: ['', ''],
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
