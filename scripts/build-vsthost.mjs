// Builds the VST3 helper (native/vsthost) into build/vsthost/vsthost.exe.
// Fetches Steinberg's VST3 SDK (MIT) at a pinned commit into build/vst3sdk the first time,
// then compiles with MSVC - found through vswhere, no CMake needed. Windows only for now.
//
//   node scripts/build-vsthost.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SDK_REPO = 'https://github.com/steinbergmedia/vst3sdk.git'
const SDK_COMMIT = '3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96'
const SDK_PARTS = ['base', 'pluginterfaces', 'public.sdk']

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = join(root, 'build', 'vst3sdk')
const out = join(root, 'build', 'vsthost')
const tests = process.argv.includes('--tests')
const entry = tests ? 'session_tests.cpp' : 'vsthost.cpp'
const executable = tests ? 'session-tests.exe' : 'vsthost.exe'

if (process.platform !== 'win32') {
  console.log('vsthost: only Windows builds are set up so far - skipping.')
  process.exit(0)
}

const git = (...args) => execFileSync('git', args, { cwd: sdk, stdio: 'inherit' })

if (!existsSync(join(sdk, 'public.sdk', 'source'))) {
  mkdirSync(sdk, { recursive: true })
  git('init', '-q')
  git('remote', 'add', 'origin', SDK_REPO)
  git('fetch', '-q', '--depth', '1', 'origin', SDK_COMMIT)
  git('checkout', '-q', 'FETCH_HEAD')
  git('submodule', 'update', '--init', '--depth', '1', ...SDK_PARTS)
}

const sources = [
  'pluginterfaces/base/conststringtable.cpp',
  'pluginterfaces/base/coreiids.cpp',
  'pluginterfaces/base/funknown.cpp',
  'pluginterfaces/base/ustring.cpp',
  'base/source/baseiids.cpp',
  'base/source/fbuffer.cpp',
  'base/source/fdebug.cpp',
  'base/source/fdynlib.cpp',
  'base/source/fobject.cpp',
  'base/source/fstreamer.cpp',
  'base/source/fstring.cpp',
  'base/source/timer.cpp',
  'base/source/updatehandler.cpp',
  'base/thread/source/fcondition.cpp',
  'base/thread/source/flock.cpp',
  'public.sdk/source/common/commoniids.cpp',
  'public.sdk/source/common/commonstringconvert.cpp',
  'public.sdk/source/common/memorystream.cpp',
  'public.sdk/source/vst/hosting/eventlist.cpp',
  'public.sdk/source/vst/hosting/hostclasses.cpp',
  'public.sdk/source/vst/hosting/module.cpp',
  'public.sdk/source/vst/hosting/module_win32.cpp',
  'public.sdk/source/vst/hosting/parameterchanges.cpp',
  'public.sdk/source/vst/hosting/pluginterfacesupport.cpp',
  'public.sdk/source/vst/hosting/processdata.cpp',
  'public.sdk/source/vst/utility/stringconvert.cpp',
  'public.sdk/source/vst/vstinitiids.cpp',
].map((s) => join(sdk, s))

// vswhere ships with every Visual Studio install since 2017.
const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
if (!vs) throw new Error('vsthost: no Visual Studio with the C++ tools found')
const vcvars = join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')

mkdirSync(join(out, 'obj'), { recursive: true })
const cl = [
  'cl', '/nologo', '/std:c++17', '/EHsc', '/O2', '/MT', '/W3', '/utf-8',
  '/DNOMINMAX', '/DUNICODE', '/D_UNICODE', '/DRELEASE=1', '/D_CRT_SECURE_NO_WARNINGS',
  `/I"${sdk}"`, `/Fo"${join(out, 'obj')}\\\\"`, `/Fe"${join(out, executable)}"`,
  `"${join(root, 'native', 'vsthost', entry)}"`, ...sources.map((s) => `"${s}"`),
  '/link', '/SUBSYSTEM:CONSOLE', 'ole32.lib', 'user32.lib', 'shell32.lib', 'gdi32.lib',
].join(' ')
// cmd needs the whole line in one script to keep vcvars' environment for cl.
const bat = join(out, 'build.bat')
writeFileSync(bat, `@echo off\r\ncall "${vcvars}" >nul || exit /b 1\r\n${cl}\r\n`)
execFileSync('cmd.exe', ['/d', '/c', bat], { stdio: 'inherit' })
console.log(`vsthost: built ${join(out, executable)}`)
