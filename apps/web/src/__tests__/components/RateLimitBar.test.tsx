import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { RateLimitBar, useRateLimitExhausted } from "@/components/RateLimitBar"
import { renderHook } from "@testing-library/react"

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn(),
}))

import useSWR from "swr"

const mockUseSWR = useSWR as ReturnType<typeof vi.fn>

describe("RateLimitBar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when data is not available", () => {
    mockUseSWR.mockReturnValue({ data: undefined })
    const { container } = render(<RateLimitBar />)
    expect(container.firstChild).toBeNull()
  })

  it("shows rate limited message when remaining is 0", () => {
    mockUseSWR.mockReturnValue({
      data: { remaining: 0, limit: 5000, reset: null },
    })
    render(<RateLimitBar />)
    expect(screen.getByText(/Rate limited/)).toBeTruthy()
    expect(screen.getByText(/resets soon/)).toBeTruthy()
  })

  it("shows warning when remaining is less than 100", () => {
    mockUseSWR.mockReturnValue({
      data: { remaining: 42, limit: 5000, reset: null },
    })
    render(<RateLimitBar />)
    expect(screen.getByText("GitHub API: 42/5000")).toBeTruthy()
  })

  it("shows normal state when remaining is above 100", () => {
    mockUseSWR.mockReturnValue({
      data: { remaining: 4800, limit: 5000, reset: null },
    })
    render(<RateLimitBar />)
    expect(screen.getByText("GitHub API: 4800/5000")).toBeTruthy()
  })

  it("shows reset time when remaining is 0 and reset is provided", () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600
    mockUseSWR.mockReturnValue({
      data: { remaining: 0, limit: 5000, reset: resetTimestamp },
    })
    render(<RateLimitBar />)
    expect(screen.getByText(/Rate limited/)).toBeTruthy()
  })
})

describe("useRateLimitExhausted", () => {
  it("returns false when data is undefined", () => {
    mockUseSWR.mockReturnValue({ data: undefined })
    const { result } = renderHook(() => useRateLimitExhausted())
    expect(result.current).toBe(false)
  })

  it("returns true when remaining is 0", () => {
    mockUseSWR.mockReturnValue({
      data: { remaining: 0, limit: 5000, reset: null },
    })
    const { result } = renderHook(() => useRateLimitExhausted())
    expect(result.current).toBe(true)
  })

  it("returns false when remaining is above 0", () => {
    mockUseSWR.mockReturnValue({
      data: { remaining: 100, limit: 5000, reset: null },
    })
    const { result } = renderHook(() => useRateLimitExhausted())
    expect(result.current).toBe(false)
  })
})
