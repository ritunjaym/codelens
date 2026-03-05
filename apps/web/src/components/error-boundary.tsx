"use client"

import React from "react"
import { useRouter } from "next/navigation"

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

class ErrorBoundaryClass extends React.Component<
  ErrorBoundaryProps & { onReset: () => void },
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps & { onReset: () => void }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {this.state.error?.message ?? "An unexpected error occurred"}
          </p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              this.props.onReset()
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function ErrorBoundary({ children }: ErrorBoundaryProps) {
  const router = useRouter()
  return (
    <ErrorBoundaryClass onReset={() => router.refresh()}>
      {children}
    </ErrorBoundaryClass>
  )
}
