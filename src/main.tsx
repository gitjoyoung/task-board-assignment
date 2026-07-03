import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 뮤테이션 응답으로 캐시를 직접 갱신하는 전략이므로
      // 자동 재조회(포커스/마운트)로 5,000개 GET이 반복되지 않게 막습니다.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 2, // 초기 로드의 드문 500은 조용히 재시도, 그래도 실패하면 에러 UI
    },
  },
})

async function enableMocking() {
  const { worker } = await import('./mocks/browser')
  // service worker 등록 경로는 배포 base 를 따라갑니다 (GitHub Pages 대응).
  return worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
  })
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
})
