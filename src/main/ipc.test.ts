import { describe, expect, it } from 'vitest'
import { validateCaptainSend } from './ipc'

const UUID = '0123456789abcdef'

describe('validateCaptainSend', () => {
  it('rejects a non-string uuid', () => {
    expect(() => validateCaptainSend(42, 'hello', UUID)).toThrowError('invalid captain message')
  })

  it('rejects an empty uuid', () => {
    expect(() => validateCaptainSend('', 'hello', UUID)).toThrowError('invalid captain message')
  })

  it('rejects a non-string text', () => {
    expect(() => validateCaptainSend(UUID, null, UUID)).toThrowError('invalid captain message')
  })

  it('rejects an empty text', () => {
    expect(() => validateCaptainSend(UUID, '', UUID)).toThrowError('invalid captain message')
  })

  it('rejects when no workspace is current', () => {
    expect(() => validateCaptainSend(UUID, 'hello', null)).toThrowError('no current workspace')
  })

  it('rejects a uuid that is not the current workspace', () => {
    expect(() => validateCaptainSend('ffffffffffffffff', 'hello', UUID)).toThrowError(
      'captain is not current'
    )
  })

  it('accepts the current uuid with non-empty text', () => {
    expect(() => validateCaptainSend(UUID, 'hello', UUID)).not.toThrow()
  })

  it('checks shape before currency', () => {
    // A malformed message is reported as invalid even with no current workspace.
    expect(() => validateCaptainSend('', 'hello', null)).toThrowError('invalid captain message')
    expect(() => validateCaptainSend(UUID, '', null)).toThrowError('invalid captain message')
  })

  it('checks currency before match', () => {
    // A well-formed message with no workspace is reported as missing currency,
    // not as a mismatch.
    expect(() => validateCaptainSend('ffffffffffffffff', 'hello', null)).toThrowError(
      'no current workspace'
    )
  })
})
