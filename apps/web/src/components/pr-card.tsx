"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef } from "react"

export interface PRCardData {
  number: number
  title: string
  repo: string
  owner: string
  author: string
  authorAvatar: string
  createdAt: string
  fileCount: number
  additions: number
  deletions: number
  isDraft: boolean
}

export function PRCard({ pr }: { pr: PRCardData }) {
  const router = useRouter()
  const prefetchedRef = useRef(new Set<string>())
  const relativeTime = getRelativeTime(pr.createdAt)
  const prUrl = `/pr/${pr.owner}/${pr.repo}/${pr.number}`

  const handleMouseEnter = () => {
    if (!prefetchedRef.current.has(prUrl)) {
      router.prefetch(prUrl)
      prefetchedRef.current.add(prUrl)
    }
  }

  return (
    <div
      className="border border-border rounded-lg p-4 hover:border-primary/50 transition-colors duration-150 bg-card group"
      onMouseEnter={handleMouseEnter}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground font-mono">{pr.owner}/{pr.repo}</span>
            {pr.isDraft && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Draft</span>
            )}
          </div>
          <Link
            href={`/pr/${pr.owner}/${pr.repo}/${pr.number}`}
            className="font-medium text-sm hover:text-primary transition-colors line-clamp-2"
          >
            #{pr.number} {pr.title}
          </Link>
        </div>
      </div>
      
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <img
            src={pr.authorAvatar}
            alt={`${pr.author}'s avatar`}
            width={16}
            height={16}
            className="rounded-full"
          />
          <span>{pr.author}</span>
        </div>
        <span>{relativeTime}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-green-600 dark:text-green-400">+{pr.additions}</span>
          <span className="text-red-600 dark:text-red-400">-{pr.deletions}</span>
          <span className="text-muted-foreground">{pr.fileCount} files</span>
        </span>
      </div>
      
      <Link
        href={`/pr/${pr.owner}/${pr.repo}/${pr.number}`}
        className="mt-3 w-full hidden group-hover:block text-center text-xs py-1.5 px-3 bg-primary text-primary-foreground rounded font-medium hover:opacity-90 transition-opacity"
      >
        Review →
      </Link>
    </div>
  )
}

export function PRCardSkeleton() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card animate-pulse">
      <div className="h-3 bg-muted rounded w-1/3 mb-2" />
      <div className="h-4 bg-muted rounded w-3/4 mb-3" />
      <div className="flex gap-3">
        <div className="h-3 bg-muted rounded w-16" />
        <div className="h-3 bg-muted rounded w-20" />
      </div>
    </div>
  )
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
