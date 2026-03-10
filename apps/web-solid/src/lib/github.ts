const API_BASE = '/api/github'

async function githubFetch<T>(path: string): Promise<T> {
  // path may include query params like /user/repos?sort=pushed
  // Split into endpoint and existing query string
  const [endpoint, qs] = path.startsWith('/') ? path.slice(1).split('?') : path.split('?')
  const url = `${API_BASE}?path=${endpoint}${qs ? `&${qs}` : ''}`
  const res = await fetch(url)
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json()
}

export interface Repo {
  full_name: string
  name: string
  owner: { login: string; avatar_url: string }
  description: string | null
  stargazers_count: number
  open_issues_count: number
}

export interface PullRequest {
  number: number
  title: string
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
  draft: boolean
  additions: number
  deletions: number
  changed_files: number
  head: { ref: string }
  base: { ref: string }
  html_url: string
  body: string | null
  labels: Array<{ name: string; color: string }>
}

export interface PRFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

export const github = {
  async getUser() {
    return githubFetch<{ login: string; name: string; avatar_url: string }>('/user')
  },
  async getRepos(page = 1) {
    return githubFetch<Repo[]>(`/user/repos?sort=pushed&per_page=20&page=${page}`)
  },
  async getPRs(owner: string, repo: string, page = 1) {
    return githubFetch<PullRequest[]>(
      `/repos/${owner}/${repo}/pulls?state=open&per_page=20&page=${page}&sort=updated`
    )
  },
  async getPR(owner: string, repo: string, number: number) {
    return githubFetch<PullRequest>(`/repos/${owner}/${repo}/pulls/${number}`)
  },
  async getPRFiles(owner: string, repo: string, number: number) {
    return githubFetch<PRFile[]>(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  },
  async getPRReviews(owner: string, repo: string, number: number) {
    return githubFetch<any[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`)
  },
  async getEvents(owner: string, repo: string, number: number) {
    return githubFetch<any[]>(`/repos/${owner}/${repo}/issues/${number}/events?per_page=30`)
  },
  async postComment(owner: string, repo: string, number: number, body: string, path: string, line: number, commitId: string) {
    const endpoint = `repos/${owner}/${repo}/pulls/${number}/comments`
    const res = await fetch(`${API_BASE}?path=${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, path, line, side: 'RIGHT', commit_id: commitId })
    })
    return res.json()
  }
}
