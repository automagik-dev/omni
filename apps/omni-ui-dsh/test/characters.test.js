import assert from 'node:assert/strict'
import test from 'node:test'
import { CHARACTERS, characterMarkup, maskOf } from '../src/client/characters.js'

// Every character must draw. A table entry missing a layer or its eyes once crashed the whole
// team surface (the Main Bot's mark), and no other test renders a character.
test('every character draws its markup and mask without a missing layer', () => {
  for (const shape of Object.keys(CHARACTERS)) {
    const markup = characterMarkup(shape, 'deepseek')
    assert.equal(typeof markup, 'string', shape)
    assert.ok(!markup.includes('undefined'), `${shape} markup has an undefined value`)
    const mask = maskOf(shape)
    assert.ok(!mask.includes('undefined'), `${shape} mask has an undefined value`)
  }
})
