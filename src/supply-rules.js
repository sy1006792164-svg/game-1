'use strict';

const SUPPLY_ENERGY = 6;
const RELIGHT_ACTION = 'relight:oil';
const NATIVE_OBJECT_SOURCE = Function.prototype.toString.call(Object);

// Accept native plain records from the WeChat SDK's realm without trusting
// custom prototypes, constructors or getters.
function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null || proto === Object.prototype) return true;
  if (Object.getPrototypeOf(proto) !== null) return false;
  const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
  if (!ctor || !Object.prototype.hasOwnProperty.call(ctor, 'value') || typeof ctor.value !== 'function' ||
      Function.prototype.toString.call(ctor.value) !== NATIVE_OBJECT_SOURCE) return false;
  const link = Object.getOwnPropertyDescriptor(ctor.value, 'prototype');
  return !!link && Object.prototype.hasOwnProperty.call(link, 'value') && link.value === proto;
}

function normalizeSupplyPolicy(value, actionCount, reviveCount) {
  const invalid = () => { throw new Error('invalid supply policy'); };
  if (!Number.isSafeInteger(actionCount) || actionCount < 0 || !Number.isSafeInteger(reviveCount) || reviveCount < 0) invalid();
  const policy = { version: 2, legacyActionCount: 0, legacyReviveCount: 0 };
  if (value === undefined) return policy;
  if (!plainRecord(value) || Object.getOwnPropertySymbols(value).length) invalid();
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 3 || keys.some(key => !Object.prototype.hasOwnProperty.call(policy, key))) invalid();
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !field.enumerable || !Object.prototype.hasOwnProperty.call(field, 'value') || !Number.isSafeInteger(field.value)) invalid();
    policy[key] = field.value;
  }
  if (policy.version !== 2 || policy.legacyActionCount < 0 || policy.legacyActionCount > actionCount ||
      policy.legacyReviveCount < 0 || policy.legacyReviveCount > reviveCount) invalid();
  return policy;
}

module.exports = { SUPPLY_ENERGY, RELIGHT_ACTION, normalizeSupplyPolicy, plainRecord };
