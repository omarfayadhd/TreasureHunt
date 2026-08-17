import { generateCode } from './codes'

describe('generateCode', () => {
  it('produces WORD-NN codes', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^[A-Z]+-\d{2}$/)
    }
  })

  it('produces varied codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()))
    expect(codes.size).toBeGreaterThan(5)
  })
})
