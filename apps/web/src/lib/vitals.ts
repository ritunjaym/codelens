import { onCLS, onINP, onLCP, onTTFB, onFCP } from "web-vitals"

export function reportWebVitals() {
  onCLS(console.log)
  onINP(console.log)
  onLCP(console.log)
  onTTFB(console.log)
  onFCP(console.log)
}
