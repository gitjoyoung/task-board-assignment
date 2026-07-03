import '@testing-library/jest-dom'

// jsdom 은 실제 레이아웃이 없어 가상화(useVirtualizer)가 0개를 렌더한다.
// 스크롤 컨테이너가 크기를 갖도록 최소 폴리필을 제공한다.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub

// @tanstack/virtual-core 는 스크롤 컨테이너 크기를 offsetWidth/offsetHeight 로 읽는다
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => 800,
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => 600,
})

// jsdom 은 HTMLDialogElement 의 open 속성 반영은 지원하지만 showModal/close 는 미구현이다.
// open 토글만 흉내내는 최소 폴리필 (TaskDialog.test.tsx 용).
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
