import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RouteGrid, { routeIssues } from './RouteGrid'
import * as adminApi from './adminApi'
import type { RouteCell, StationRow } from './adminApi'

vi.mock('./adminApi', () => ({
  setRouteCell: vi.fn(),
  setRouteCode: vi.fn(),
  clearRouteCell: vi.fn(),
  refusal: (result: unknown) =>
    result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false
      ? ((result as { error?: string }).error ?? 'unknown')
      : null,
}))

const teams = [
  { id: 'team-1', name: 'Team 1' },
  { id: 'team-2', name: 'Team 2' },
]

const stations: StationRow[] = [
  { id: 'station-1', name: 'Station 1', clue_text: 'first', sort_order: 1 },
  { id: 'station-2', name: 'Station 2', clue_text: 'second', sort_order: 2 },
]

const rows: RouteCell[] = [
  { team_id: 'team-1', level: 1, station_id: 'station-1', code: 'AAA111' },
  { team_id: 'team-1', level: 2, station_id: 'station-2', code: 'AAA222' },
  { team_id: 'team-2', level: 1, station_id: 'station-2', code: 'BBB111' },
  { team_id: 'team-2', level: 2, station_id: 'station-1', code: 'BBB222' },
]

function renderGrid(overrides: Partial<Parameters<typeof RouteGrid>[0]> = {}) {
  const onReload = vi.fn()
  render(
    <RouteGrid teams={teams} stations={stations} rows={rows} disabled={false} onReload={onReload} {...overrides} />,
  )
  return { onReload }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RouteGrid', () => {
  it("shows each cell's location and the code that belongs to that team", () => {
    renderGrid()
    expect(screen.getByLabelText('Team 1 level 1 location')).toHaveValue('station-1')
    expect(screen.getByLabelText('Team 2 level 1 location')).toHaveValue('station-2')
    expect(screen.getByText('AAA111')).toBeInTheDocument()
    expect(screen.getByText('BBB222')).toBeInTheDocument()
  })

  it('sets a cell when a location is chosen', async () => {
    vi.mocked(adminApi.setRouteCell).mockResolvedValue({ ok: true, code: 'NEW123' })
    const { onReload } = renderGrid()
    await userEvent.selectOptions(screen.getByLabelText('Team 1 level 3 location'), 'station-1')
    await waitFor(() => expect(adminApi.setRouteCell).toHaveBeenCalledWith('team-1', 3, 'station-1'))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
  })

  it('clears a cell when the blank option is chosen', async () => {
    vi.mocked(adminApi.clearRouteCell).mockResolvedValue({ ok: true })
    const { onReload } = renderGrid()
    await userEvent.selectOptions(screen.getByLabelText('Team 1 level 2 location'), '')
    await waitFor(() => expect(adminApi.clearRouteCell).toHaveBeenCalledWith('team-1', 2))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
  })

  it('reissues one code', async () => {
    vi.mocked(adminApi.setRouteCode).mockResolvedValue({ ok: true, code: 'NEW123' })
    const { onReload } = renderGrid()
    await userEvent.click(screen.getByRole('button', { name: 'New code for Team 1 level 1' }))
    await waitFor(() => expect(adminApi.setRouteCode).toHaveBeenCalledWith('team-1', 1))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
  })

  it('explains a location already taken at that level in plain words', async () => {
    vi.mocked(adminApi.setRouteCell).mockResolvedValue({ ok: false, error: 'location_taken_at_level' })
    renderGrid()
    await userEvent.selectOptions(screen.getByLabelText('Team 1 level 3 location'), 'station-2')
    expect(await screen.findByText("Station 2 is already another team's level 3 stop.")).toBeInTheDocument()
  })

  it('explains a location this team already visits', async () => {
    vi.mocked(adminApi.setRouteCell).mockResolvedValue({ ok: false, error: 'location_used_by_team' })
    renderGrid()
    await userEvent.selectOptions(screen.getByLabelText('Team 1 level 3 location'), 'station-1')
    expect(await screen.findByText('Team 1 already visits Station 1 at another level.')).toBeInTheDocument()
  })

  it('disables every control while the hunt is running', () => {
    renderGrid({ disabled: true })
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('does not offer the treasure location as a route stop', () => {
    renderGrid({ treasureStationId: 'station-2' })
    const options = [...screen.getByLabelText('Team 1 level 3 location').querySelectorAll('option')]
    expect(options.map(o => o.textContent)).toEqual(['—', 'Station 1'])
  })

  it('reports nothing when every route is complete and staggered', () => {
    expect(routeIssues(teams, stations, rows)).toEqual([])
  })

  it('lists an empty cell by team and level', () => {
    const holed = rows.filter(r => !(r.team_id === 'team-1' && r.level === 2))
    expect(routeIssues(teams, stations, holed)).toContain('Team 1 has no level 2 stop.')
  })

  it('flags routes of different lengths', () => {
    const shorter = rows.filter(r => !(r.team_id === 'team-2' && r.level === 2))
    expect(routeIssues(teams, stations, shorter).join(' ')).toMatch(/same length/i)
  })

  it('flags fewer locations than teams', () => {
    const issues = routeIssues(teams, [stations[0]], rows)
    expect(issues.join(' ')).toMatch(/at least 2 locations/i)
  })

  it('asks for a route when a team has none at all', () => {
    const onlyTeamOne = rows.filter(r => r.team_id === 'team-1')
    expect(routeIssues(teams, stations, onlyTeamOne)).toContain('Team 2 has no route yet.')
  })
})
