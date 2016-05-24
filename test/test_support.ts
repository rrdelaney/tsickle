import {expect} from 'chai';
import * as fs from 'fs';
import * as ts from 'typescript';
import * as glob from 'glob';
import * as path from 'path';

import * as tsickle from '../src/tsickle';

/** The TypeScript compiler options used by the test suite. */
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES6,
  skipDefaultLibCheck: true,
  noEmitOnError: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  noEmitHelpers: true,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.React,
};

const {cachedLibPath, cachedLib} = (function() {
  let host = ts.createCompilerHost(compilerOptions);
  let fn = host.getDefaultLibFileName(compilerOptions);
  let p = ts.getDefaultLibFilePath(compilerOptions);
  return {cachedLibPath: p, cachedLib: host.getSourceFile(fn, ts.ScriptTarget.ES6)};
})();

/** Creates a ts.Program from a set of input files.  Throws an exception on errors. */
export function createProgram(sources: {[fileName: string]: string}): ts.Program {
  let host = ts.createCompilerHost(compilerOptions);
  let original = host.getSourceFile.bind(host);
  host.getSourceFile = function(
                           fileName: string, languageVersion: ts.ScriptTarget,
                           onError?: (msg: string) => void): ts.SourceFile {
    if (fileName === cachedLibPath) return cachedLib;
    if (sources.hasOwnProperty(fileName)) {
      return ts.createSourceFile(fileName, sources[fileName], ts.ScriptTarget.Latest, true);
    }
    return original(fileName, languageVersion, onError);
  };

  let program = ts.createProgram(Object.keys(sources), compilerOptions, host);
  let diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(tsickle.formatDiagnostics(diagnostics));
  }

  return program;
}

/** Emits transpiled output with tsickle postprocessing.  Throws an exception on errors. */
export function emit(program: ts.Program): {[filename: string]: string} {
  let transformed: {[fileName: string]: string} = {};
  let emitRes = program.emit(undefined, (fileName: string, data: string) => {
    transformed[fileName] =
        tsickle.convertCommonJsToGoogModule(fileName, data, pathToModuleName).output
  });
  if (emitRes.diagnostics.length) {
    throw new Error(tsickle.formatDiagnostics(emitRes.diagnostics));
  }

  return transformed;

  function pathToModuleName(context: string, fileName: string): string {
    if (fileName[0] === '.') {
      fileName = path.join(path.dirname(context), fileName);
    }
    return fileName.replace(/^.+\/test_files\//, 'tsickle_test/')
        .replace(/\.js$/, '')
        .replace(/\//g, '.');
  }
}

export class GoldenFileTest {
  // Path to directory containing test files.
  path: string;
  // Input .ts/.tsx file names.
  tsFiles: string[];

  constructor(path: string, tsFiles: string[]) {
    this.path = path;
    this.tsFiles = tsFiles;
  }

  get name(): string { return path.basename(this.path); }

  get externsPath(): string { return path.join(this.path, 'externs.js'); }

  get tsPaths(): string[] { return this.tsFiles.map(f => path.join(this.path, f)); }

  get jsPaths(): string[] {
    return this.tsFiles.map(f => path.join(this.path, GoldenFileTest.tsPathToJs(f)));
  }

  public static tsPathToJs(tsPath: string): string { return tsPath.replace(/\.tsx?$/, '.js'); }
}

export function goldenTests(): GoldenFileTest[] {
  let basePath = path.join(__dirname, '..', '..', 'test_files');
  let testNames = fs.readdirSync(basePath);

  let tests = testNames.map(testName => {
    let testDir = path.join(basePath, testName);
    let tsPaths = glob.sync(path.join(testDir, '*.ts'));
    tsPaths = tsPaths.concat(glob.sync(path.join(testDir, '*.tsx')));
    tsPaths = tsPaths.filter(p => !p.match(/\.tsickle\./));
    let tsFiles = tsPaths.map(f => path.relative(testDir, f));
    return new GoldenFileTest(testDir, tsFiles);
  });

  return tests;
}
