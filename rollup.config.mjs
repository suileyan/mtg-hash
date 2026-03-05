// rollup.config.mjs
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true,
      exports: 'named'
    },
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      exports: 'named',
      sourcemap: true
    }
  ],
  external: ['spark-md5', 'p-limit'],
  plugins: [
    typescript({
      declaration: true,
      declarationDir: 'dist/types',
      rootDir: 'src',
      exclude: ['**/*.test.ts', '**/*.spec.ts']
    }),
    nodeResolve({
      preferBuiltins: false,
      browser: true
    }),
    commonjs({
      transformMixedEsModules: true
    }),
    terser({
      format: {
        comments: false,
        ecma: 2018
      },
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      },
      mangle: {
        safari10: true
      }
    })
  ],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false
  }
};
