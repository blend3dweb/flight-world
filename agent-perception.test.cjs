const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyPerception } = require('./ollama-vision-dispatcher.cjs');

test('negative airport descriptions require reinspection', () => {
  assert.equal(classifyPerception(
    'There are no visible objects or structures that resemble an airport. No, the required objects are not visibly present.',
    ['airport'],
  ), 'defect');
  assert.equal(classifyPerception(
    'There are no identifiable features that would indicate the presence of an airport.',
    ['airport'],
  ), 'defect');
});

test('visible runway descriptions can pass', () => {
  assert.equal(classifyPerception(
    'The nighttime airport runway is illuminated by lights, with the terminal visible nearby.',
    ['airport'],
  ), 'pass');
});
