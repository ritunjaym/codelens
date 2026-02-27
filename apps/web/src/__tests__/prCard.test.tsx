import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PRCard, PRCardData } from "@/components/pr-card"

const mockPR: PRCardData = {
  number: 42,
  title: "feat: add auth middleware",
  repo: "codelens",
  owner: "testuser",
  author: "alice",
  authorAvatar: "https://github.com/alice.png",
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  fileCount: 5,
  additions: 120,
  deletions: 30,
  isDraft: false,
}

describe("PRCard", () => {
  it("renders PR title and number", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.getByText(/#42 feat: add auth middleware/)).toBeTruthy()
  })

  it("renders repo name", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.getByText("testuser/codelens")).toBeTruthy()
  })

  it("renders additions and deletions", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.getByText("+120")).toBeTruthy()
    expect(screen.getByText("-30")).toBeTruthy()
  })

  it("renders file count", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.getByText("5 files")).toBeTruthy()
  })

  it("renders author name", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.getByText("alice")).toBeTruthy()
  })

  it("does not show Draft badge when not draft", () => {
    render(<PRCard pr={mockPR} />)
    expect(screen.queryByText("Draft")).toBeNull()
  })

  it("shows Draft badge for draft PRs", () => {
    render(<PRCard pr={{ ...mockPR, isDraft: true }} />)
    expect(screen.getByText("Draft")).toBeTruthy()
  })
})
