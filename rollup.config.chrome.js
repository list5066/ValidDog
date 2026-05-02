import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';

/**
 * srcフォルダ内の静的ファイルをdistにコピーするプラグイン
 */
function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    buildEnd() {
      // distディレクトリを作成（存在しない場合）
      try {
        mkdirSync('dist', { recursive: true });
      } catch (e) {
        // ディレクトリが既に存在する場合は無視
      }

      // コピーするファイルのリスト
      const filesToCopy = [
        'manifest.json',
        'devtools.html',
        'panel.html',
        'styles-panel.css'
      ];

      filesToCopy.forEach(file => {
        const srcPath = `src/${file}`;
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, `dist/${file}`);
          console.log(`Copied: ${srcPath} -> dist/${file}`);
        }
      });

      // iconsフォルダをコピー
      try {
        mkdirSync('dist/icons', { recursive: true });
        const iconFiles = readdirSync('src/icons');
        iconFiles.forEach(file => {
          if (!file.startsWith('.')) {
            copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
            console.log(`Copied: src/icons/${file} -> dist/icons/${file}`);
          }
        });
      } catch (e) {
        console.error('Failed to copy icons:', e.message);
      }
    }
  };
}

/**
 * 共通のTypeScriptプラグイン設定
 */
const tsPlugin = typescript({
  tsconfig: './tsconfig.json',
  declaration: false,
  declarationMap: false,
  compilerOptions: {
    declaration: false,
    declarationMap: false
  }
});

/**
 * 共通のプラグイン設定
 */
const commonPlugins = [
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs(),
  json()
];

/**
 * Background script (Service Worker)
 */
const backgroundConfig = {
  input: 'src/background.ts',
  output: {
    file: 'dist/background.js',
    format: 'iife',
    sourcemap: process.env.SOURCEMAP === 'true',
    name: 'Background'
  },
  plugins: [
    ...commonPlugins,
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false
    }),
    copyStaticFiles()
  ]
};

/**
 * DevTools script
 */
const devtoolsConfig = {
  input: 'src/devtools.ts',
  output: {
    file: 'dist/devtools.js',
    format: 'iife',
    sourcemap: process.env.SOURCEMAP === 'true',
    name: 'DevTools'
  },
  plugins: [
    ...commonPlugins,
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false
    })
  ]
};

/**
 * Panel script
 */
const panelConfig = {
  input: 'src/panel.ts',
  output: {
    file: 'dist/panel.js',
    format: 'iife',
    sourcemap: process.env.SOURCEMAP === 'true',
    name: 'Panel'
  },
  plugins: [
    ...commonPlugins,
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false
    })
  ]
};

export default [
  backgroundConfig,
  devtoolsConfig,
  panelConfig
];
