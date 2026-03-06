import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RankBadge } from "@/components/rank-badge"

// Tests for RankBadge (the score/rank badge component)
describe("ScoreBadge / RankBadge", () => {
  it("renders rank number when rank is provided", () => {
    render(<RankBadge file={{ rank: 1, finalScore: 0.9 }} />)
    expect(screen.getByText("#1")).toBeTruthy()
  })

  it("renders score when no rank is provided", () => {
    render(<RankBadge file={{ finalScore: 0.75 }} />)
    expect(screen.getByText("0.75")).toBeTruthy()
  })

  it("has aria-label with score information", () => {
    render(<RankBadge file={{ finalScore: 0.85, rank: 2 }} />)
    const el = screen.getByLabelText(/ML score/)
    expect(el).toBeTruthy()
  })

  it("shows score breakdown tooltip when scores are provided", () => {
    render(
      <RankBadge
        file={{
          rank: 1,
          finalScore: 0.9,
          rerankerScore: 0.85,
          retrievalScore: 0.95,
        }}
      />
    )
    expect(screen.getByText("ML Score Breakdown")).toBeTruthy()
  })

  it("displays reranker and retrieval scores in breakdown", () => {
    render(
      <RankBadge
        file={{
          rank: 3,
          finalScore: 0.7,
          rerankerScore: 0.65,
          retrievalScore: 0.75,
        }}
      />
    )
    // Scores in tooltip use toFixed(4)
    expect(screen.getByText("0.6500")).toBeTruthy()
    expect(screen.getByText("0.7500")).toBeTruthy()
  })

  it("renders correctly with only finalScore (no optional fields)", () => {
    render(<RankBadge file={{ finalScore: 0.5 }} />)
    // Badge uses toFixed(2)
    expect(screen.getByText("0.50")).toBeTruthy()
  })
})
