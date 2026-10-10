import { expect, test } from 'claude-code/testing'

import { claudeDirOf, expandHome, homeOf, isWindowsHome, tmpOf } from '../hooks/kit/paths'

test('the home folder is USERPROFILE on Windows and HOME elsewhere', () => {
  expect(homeOf({ userProfile: 'C:\\Users\\dev', home: '/c/Users/dev' })).toBe('C:/Users/dev')
  expect(homeOf({ home: '/Users/dev' })).toBe('/Users/dev')
  expect(homeOf({ userProfile: '/mnt/c/odd', home: '/home/dev' })).toBe('/home/dev')
  expect(homeOf({})).toBe('')
  expect(isWindowsHome('C:/Users/dev')).toBe(true)
  expect(isWindowsHome('/home/dev')).toBe(false)
})

test('the Claude folder follows CLAUDE_CONFIG_DIR, else <home>/.claude', () => {
  expect(claudeDirOf({ home: '/home/dev' })).toBe('/home/dev/.claude')
  expect(claudeDirOf({ home: '/home/dev', configDir: '/opt/claude/' })).toBe('/opt/claude')
  expect(claudeDirOf({ userProfile: 'C:\\Users\\dev' })).toBe('C:/Users/dev/.claude')
})

test('the temp folder matches Node os.tmpdir() on each system', () => {
  expect(tmpOf(true, { tmpdir: '/tmp', temp: 'C:\\Users\\dev\\AppData\\Local\\Temp' })).toBe('C:/Users/dev/AppData/Local/Temp')
  expect(tmpOf(false, { tmpdir: '/var/folders/x/T/', temp: 'ignored' })).toBe('/var/folders/x/T')
  expect(tmpOf(false, {})).toBe('/tmp')
})

test('~ expands to the home folder', () => {
  expect(expandHome('~/briefs/a.md', '/home/dev')).toBe('/home/dev/briefs/a.md')
  expect(expandHome('~', '/home/dev')).toBe('/home/dev')
  expect(expandHome('/abs/a.md', '/home/dev')).toBe('/abs/a.md')
  expect(expandHome('~/a.md', '')).toBe('~/a.md')
})
