const commonjs = require('rollup-plugin-commonjs');
const json = require('rollup-plugin-json');
const { eslint } = require('rollup-plugin-eslint');
const uglify = require('rollup-plugin-uglify-es');

module.exports = {
    input: 'src/index.js',
    output: {
        file: 'dist/bundle.js',
        format: 'cjs',
    },
    plugins: [
        eslint({
            throwOnError: true,
            throwOnWarning: true
        }),
        commonjs(),
        json(),
        (process.env.NODE_ENV === 'production' ? uglify({
            mangle: {
                keep_fnames: true,
            },
            output: {
                beautify: false,
            }
        }): null),
    ],
};
