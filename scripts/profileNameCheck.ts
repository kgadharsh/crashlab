import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeProfileName, profileNameKey, profileNameProblem } from '../server/src/profileName'

test('normalizes profile usernames and uniqueness keys', () => {
  assert.equal(normalizeProfileName('  Ｒacer   One  '), 'Racer One')
  assert.equal(profileNameKey('Racer One'), profileNameKey('racer   one'))
  assert.equal(profileNameProblem('Racer One'), null)
})

test('rejects malformed or violent and profane usernames', () => {
  for (const name of ['xy', 'a!b', 'killer', 'Murderer', 's.h.i.t', 'sh1t', 'sh!t', 'f.u.c.k', 'ass']) {
    assert.notEqual(profileNameProblem(name), null, name)
  }
})

test('does not reject blocked fragments inside ordinary words', () => {
  assert.equal(profileNameProblem('Classic Racer'), null)
  assert.equal(profileNameProblem('Skilled Racer'), null)
})
