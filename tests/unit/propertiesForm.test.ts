import { describe, it, expect } from 'vitest'
import {
  parseLayerNumber,
  clampTransformValue,
} from '../../src/panels/RightPanel/transformValidation'
import {
  listIndexToStoreIndex,
  storeIndexToListIndex,
} from '../../src/panels/LeftPanel/listOrder'
import { MIN_LAYER_SIZE } from '../../src/canvas/resize'

/**
 * Pure-function unit tests for the Phase 06 editor controls.
 *
 * The store's select/delete/reorder/reset/transform transitions are already
 * covered in compositionStore.test.ts — these tests cover ONLY the pure helpers
 * extracted from the PropertiesForm validation and the LayerList list<->store
 * index mapping, which the component tests would otherwise be unable to pin
 * down directly.
 */

describe('parseLayerNumber', () => {
  it('parses integer and decimal strings', () => {
    expect(parseLayerNumber('0')).toBe(0)
    expect(parseLayerNumber('42')).toBe(42)
    expect(parseLayerNumber('12.5')).toBe(12.5)
  })

  it('parses negative values (off-canvas x/y is allowed)', () => {
    expect(parseLayerNumber('-10')).toBe(-10)
    expect(parseLayerNumber('-3.7')).toBe(-3.7)
  })

  it('trims whitespace before parsing', () => {
    expect(parseLayerNumber('  5  ')).toBe(5)
    expect(parseLayerNumber('\t10\n')).toBe(10)
  })

  it('returns null for empty string so the caller skips writing NaN', () => {
    expect(parseLayerNumber('')).toBeNull()
    expect(parseLayerNumber('   ')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseLayerNumber('abc')).toBeNull()
    expect(parseLayerNumber('1px')).toBeNull()
    expect(parseLayerNumber('--')).toBeNull()
  })

  it('rejects Infinity and NaN explicitly', () => {
    expect(parseLayerNumber('Infinity')).toBeNull()
    expect(parseLayerNumber('NaN')).toBeNull()
  })
})

describe('clampTransformValue', () => {
  it('clamps values below the minimum up to the minimum', () => {
    expect(clampTransformValue(0, MIN_LAYER_SIZE)).toBe(MIN_LAYER_SIZE)
    expect(clampTransformValue(-5, MIN_LAYER_SIZE)).toBe(MIN_LAYER_SIZE)
    expect(clampTransformValue(MIN_LAYER_SIZE - 1, MIN_LAYER_SIZE)).toBe(
      MIN_LAYER_SIZE,
    )
  })

  it('leaves values at or above the minimum unchanged', () => {
    expect(clampTransformValue(MIN_LAYER_SIZE, MIN_LAYER_SIZE)).toBe(
      MIN_LAYER_SIZE,
    )
    expect(clampTransformValue(100, MIN_LAYER_SIZE)).toBe(100)
    expect(clampTransformValue(9999, MIN_LAYER_SIZE)).toBe(9999)
  })

  it('respects an arbitrary minimum', () => {
    expect(clampTransformValue(3, 10)).toBe(10)
    expect(clampTransformValue(15, 10)).toBe(15)
  })
})

describe('listIndexToStoreIndex / storeIndexToListIndex', () => {
  // Example: store array (ascending, base first):
  //   [base(0), o1(1), o2(2), o3(3)]   length 4
  // Displayed list (descending, topmost first):
  //   [o3, o2, o1, base]
  //    0   1   2   3
  // So displayed[0] == o3 == store[3], displayed[3] == base == store[0].

  it('maps the topmost displayed row to the last store index', () => {
    expect(listIndexToStoreIndex(0, 4)).toBe(3)
  })

  it('maps the bottom displayed row (base) to store index 0', () => {
    expect(listIndexToStoreIndex(3, 4)).toBe(0)
  })

  it('maps every displayed index correctly for length 4', () => {
    expect(listIndexToStoreIndex(1, 4)).toBe(2)
    expect(listIndexToStoreIndex(2, 4)).toBe(1)
  })

  it('storeIndexToListIndex is the inverse of listIndexToStoreIndex', () => {
    for (let list = 0; list < 5; list++) {
      const store = listIndexToStoreIndex(list, 5)
      expect(storeIndexToListIndex(store, 5)).toBe(list)
    }
  })

  it('keeps the base (store 0) at the bottom of the displayed list', () => {
    // Base lives at store index 0 -> displayed index length-1 (the bottom).
    expect(storeIndexToListIndex(0, 4)).toBe(3)
    expect(storeIndexToListIndex(0, 7)).toBe(6)
  })

  it('handles length-1 composition (base only)', () => {
    expect(listIndexToStoreIndex(0, 1)).toBe(0)
    expect(storeIndexToListIndex(0, 1)).toBe(0)
  })
})
