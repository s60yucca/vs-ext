# Implementation Plan: Claude Code Model Mapper

## Overview

Triển khai VS Code extension theo kiến trúc đã thiết kế: Proxy Server → Model Mapper → LM Provider, với Config Panel và Traffic Panel dạng Webview. Stack: TypeScript, Node.js `http` module, Vitest + fast-check.

## Tasks

- [x] 1. Khởi tạo cấu trúc project và định nghĩa types
  - Tạo `package.json` với VS Code extension manifest, dependencies (vitest, fast-check), devDependencies
  - Tạo `tsconfig.json` cho extension host
  - Tạo `src/types.ts` định nghĩa toàn bộ interfaces: `ModelConfig`, `LMProviderConfig`, `RequestEvent`, `RequestStatus`, `ProxyServerOptions`, message protocol types
  - Tạo `src/extension.ts` skeleton với `activate()` và `deactivate()`
  - Đăng ký contribution points trong `package.json`: commands, configuration schema (settings), activityBar, viewsContainers
  - _Requirements: 1.1, 2.1, 7.1, 7.3_

- [x] 2. Implement ModelMapper
  - [x] 2.1 Implement `src/modelMapper.ts` với hàm `resolve(sourceModel, configs)`
    - Exact match trước: tìm config có `sourceModel === input` và `enabled === true`
    - Prefix match sau: tìm config có `input.startsWith(config.sourceModel)` và `enabled === true`
    - Pass-through nếu không khớp: trả về `sourceModel` gốc
    - _Requirements: 3.1, 3.2, 3.3, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 2.2 Write property test: Property 1 — exact match resolution
    - **Property 1: Model resolution — exact match**
    - **Validates: Requirements 3.1, 3.2**
    - File: `src/test/modelMapper.test.ts`

  - [ ]* 2.3 Write property test: Property 2 — prefix match resolution
    - **Property 2: Model resolution — prefix match**
    - **Validates: Requirements 6.5, 6.2, 6.3, 6.4**
    - File: `src/test/modelMapper.test.ts`

  - [ ]* 2.4 Write property test: Property 3 — pass-through khi không có match
    - **Property 3: Pass-through khi không có match**
    - **Validates: Requirements 3.3**
    - File: `src/test/modelMapper.test.ts`

- [x] 3. Implement ConfigStore
  - [x] 3.1 Implement `src/configStore.ts`
    - Đọc/ghi `ModelConfig[]` từ `vscode.workspace.getConfiguration('claudeCodeModelMapper').modelConfigs`
    - Đọc/ghi `LMProviderConfig` từ VS Code settings
    - Đọc/ghi API key qua `vscode.ExtensionContext.secrets`
    - Implement `onDidChange` dùng `vscode.workspace.onDidChangeConfiguration`
    - Cung cấp default template configs (haiku/sonnet/opus) khi chưa có config
    - _Requirements: 1.5, 5.1, 5.2, 5.5, 6.6_

  - [ ]* 3.2 Write property test: Property 4 — config uniqueness invariant
    - **Property 4: Config uniqueness invariant**
    - **Validates: Requirements 1.4**
    - File: `src/test/configStore.test.ts`

  - [ ]* 3.3 Write property test: Property 5 — config persistence round-trip
    - **Property 5: Config persistence round-trip**
    - **Validates: Requirements 1.5, 5.1, 5.2**
    - File: `src/test/configStore.test.ts`

  - [ ]* 3.4 Write unit test: default template config
    - Kiểm tra template mặc định được trả về khi chưa có config
    - File: `src/test/configStore.test.ts`

- [x] 4. Implement validation
  - [x] 4.1 Implement `src/validation.ts`
    - `validateModelConfig(config)`: reject nếu `sourceModel` hoặc `targetModel` rỗng/whitespace
    - `validateBaseUrl(url)`: reject nếu không bắt đầu bằng `http://` hoặc `https://`
    - Trả về `{ valid: boolean; error?: string }`
    - _Requirements: 1.2, 1.7, 5.4_

  - [ ]* 4.2 Write property test: Property 6 — reject empty fields
    - **Property 6: Config validation — reject empty fields**
    - **Validates: Requirements 1.2, 1.7**
    - File: `src/test/validation.test.ts`

  - [ ]* 4.3 Write property test: Property 7 — URL validation reject non-HTTP/HTTPS
    - **Property 7: URL validation — reject non-HTTP/HTTPS**
    - **Validates: Requirements 5.4**
    - File: `src/test/validation.test.ts`

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement ProxyServer
  - [x] 6.1 Implement `src/proxyServer.ts`
    - Tạo Node.js `http.Server`, lắng nghe trên port từ config
    - Port conflict: thử port tiếp theo trong range `[proxyPort, proxyPortRangeEnd]`
    - Parse request body JSON, gọi `modelMapper.resolve()` để rewrite field `model`
    - Forward request đến LM Provider: copy tất cả headers (trừ `Host`), body đã rewrite, auth token
    - Forward response nguyên vẹn về Claude Code (bao gồm SSE streaming)
    - Emit `RequestEvent` qua event emitter: queued → processing → completed/error
    - Xử lý lỗi: 502 khi provider timeout, 400 khi body không phải JSON
    - Auto-restart sau crash với delay 1s, thông báo nếu thất bại 3 lần liên tiếp
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 6.2 Write property test: Property 8 — request headers và body được giữ nguyên
    - **Property 8: Request headers và body được giữ nguyên**
    - **Validates: Requirements 3.5**
    - File: `src/test/proxyServer.test.ts`

  - [ ]* 6.3 Write unit test: proxy start/stop và port conflict fallback
    - Kiểm tra start/stop lifecycle, port conflict tự động thử port tiếp theo
    - _Requirements: 2.1, 2.4, 2.5_
    - File: `src/test/proxyServer.test.ts`

  - [ ]* 6.4 Write unit test: SSE streaming forwarding
    - Kiểm tra response streaming được forward nguyên vẹn
    - _Requirements: 3.7_
    - File: `src/test/proxyServer.test.ts`

- [x] 7. Implement TrafficPanel
  - [x] 7.1 Implement `src/trafficPanel.ts` — WebviewViewProvider
    - Đăng ký với VS Code WebviewView API
    - Implement `addRequest()`, `updateRequest()`, `clearCompleted()`
    - Giới hạn 200 entries: khi vượt ngưỡng, xóa entries cũ nhất đã completed/error
    - Xử lý messages từ webview: `clearCompleted`, `ready`
    - Gửi `init` message khi webview ready với danh sách requests hiện tại
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9_

  - [x] 7.2 Tạo webview HTML/JS cho Traffic Panel (`src/webview/trafficPanel.html`)
    - Render danh sách RequestEvent: ID, sourceModel → targetModel, status badge, duration
    - Auto-scroll khi có request mới (nếu người dùng bật)
    - Nút "Clear Completed"
    - Cập nhật UI trong vòng 500ms khi nhận `update` message
    - Hỗ trợ VS Code light/dark theme qua CSS variables
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.5_

  - [ ]* 7.3 Write property test: Property 9 — request count limit
    - **Property 9: Traffic panel request count limit**
    - **Validates: Requirements 4.9**
    - File: `src/test/trafficPanel.test.ts`

  - [ ]* 7.4 Write property test: Property 10 — clear completed removes finished requests
    - **Property 10: Clear completed removes finished requests**
    - **Validates: Requirements 4.8**
    - File: `src/test/trafficPanel.test.ts`

  - [ ]* 7.5 Write property test: Property 11 — RequestEvent invariants
    - **Property 11: RequestEvent invariants**
    - **Validates: Requirements 4.2, 4.5, 4.6**
    - File: `src/test/trafficPanel.test.ts`

- [x] 8. Implement ConfigPanel
  - [x] 8.1 Implement `src/configPanel.ts` — WebviewViewProvider
    - Đăng ký với VS Code WebviewView API
    - Xử lý messages: `saveConfigs`, `saveLMProvider`, `ready`
    - Gọi `validation.ts` trước khi lưu, gửi `error` message nếu invalid
    - Gửi `init` message khi webview ready với config hiện tại
    - Áp dụng config mới cho proxy ngay lập tức (không restart)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.2 Tạo webview HTML/JS cho Config Panel (`src/webview/configPanel.html`)
    - Form thêm/sửa/xóa ModelConfig: input sourceModel, targetModel, toggle enabled
    - Hiển thị danh sách configs nhóm theo sourceModel
    - Form cấu hình LM Provider: input baseUrl, input apiKey (masked)
    - Inline error messages cho validation failures
    - Hỗ trợ VS Code light/dark theme
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 5.1, 5.2, 5.4, 7.5_

- [x] 9. Implement StatusBar
  - Implement `src/statusBar.ts` — `vscode.StatusBarItem`
  - Hiển thị trạng thái: "$(radio-tower) Proxy: localhost:PORT" khi running, "$(circle-slash) Proxy: Stopped" khi dừng, "$(error) Proxy: Error" khi lỗi
  - Click vào status bar item mở Traffic Panel
  - _Requirements: 2.2, 2.3, 7.2_

- [x] 10. Wire toàn bộ components trong Extension Host
  - [x] 10.1 Hoàn thiện `src/extension.ts`
    - Khởi tạo `ConfigStore`, `ModelMapper`, `ProxyServer`, `TrafficPanel`, `ConfigPanel`, `StatusBar`
    - Đăng ký commands: `claudeCodeModelMapper.startProxy`, `stopProxy`, `openTrafficPanel`, `openConfigPanel`
    - Subscribe `ProxyServer.onRequest` → `TrafficPanel.addRequest/updateRequest`
    - Subscribe `ConfigStore.onDidChange` → cập nhật proxy config và status bar
    - Dispose tất cả resources trong `deactivate()`
    - _Requirements: 2.1, 2.5, 5.3, 7.1, 7.2, 7.3, 7.4_

  - [x] 10.2 Xử lý error notifications
    - Hiển thị VS Code error notification khi proxy không thể khởi động (nút "Retry", "View Logs")
    - Thông báo khi auto-restart thất bại 3 lần liên tiếp
    - _Requirements: 2.6, 7.4_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks đánh dấu `*` là optional, có thể bỏ qua để ra MVP nhanh hơn
- Mỗi property test dùng fast-check với `numRuns: 100` và comment tag `// Feature: claude-code-model-mapper, Property N: ...`
- VS Code API cần mock trong test environment (không có extension host thật)
- Webview HTML có thể dùng inline script hoặc bundled JS tùy preference
