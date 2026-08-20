import { beforeEach, describe, expect, it } from 'vitest'
import { anonClient, resetDb, serviceClient } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('normalize_code', () => {
  it('strips spaces, punctuation and case', async () => {
    const { data, error } = await service.rpc('normalize_code', { p: ' man go-77! ' })
    expect(error).toBeNull()
    expect(data).toBe('MANGO77')
  })
})

describe('random_team_code', () => {
  it('returns six unambiguous alphanumerics', async () => {
    const { data, error } = await service.rpc('random_team_code')
    expect(error).toBeNull()
    expect(data as string).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('is not callable anonymously', async () => {
    const { error } = await anonClient().rpc('random_team_code')
    expect(error).not.toBeNull()
  })
})
