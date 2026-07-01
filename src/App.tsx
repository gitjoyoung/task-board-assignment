import Board from './Board'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Task Board</h1>
        <p className="hint">
          스타터 baseline입니다. 요구사항은 <strong>과제 명세서</strong>를 참고하세요.
        </p>
      </header>
      <Board />
    </div>
  )
}
