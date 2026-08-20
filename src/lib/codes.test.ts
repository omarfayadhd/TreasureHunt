import { generateCode } from './codes'

describe('generateCode', () => {
  it('produces only uppercase letters and digits', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[A-Z0-9]{3,12}$/)
  })

  it('varies between calls', () => {
    const codes = new Set(Array.from({ length: 50 }, generateCode))
    expect(codes.size).toBeGreaterThan(1)
  })
})
