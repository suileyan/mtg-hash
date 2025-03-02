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
      sourcemap: true
    },
    {
      file: 'dist/index.cjs.js',
      format: "cjs",
      exports: "named",
      sourcemap: true
    }
  ],
  plugins: [
    typescript({
      declaration: true,
      declarationDir: 'dist/types',
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        declaration: true,
      }
    }),
    nodeResolve(),
    commonjs(),
    terser({
      format: {
        comments: false,
        ecma: 2018
      },
      compress: {
        drop_console: true,
        passes: 3
      }
    })
  ]
};