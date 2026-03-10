import { onCLS, onINP, onLCP, onTTFB, onFCP } from 'web-vitals'

export function reportWebVitals() {
  onCLS(m => console.debug('[CLS]', m.value))
  onINP(m => console.debug('[INP]', m.value))
  onLCP(m => console.debug('[LCP]', m.value))
  onTTFB(m => console.debug('[TTFB]', m.value))
  onFCP(m => console.debug('[FCP]', m.value))
}
