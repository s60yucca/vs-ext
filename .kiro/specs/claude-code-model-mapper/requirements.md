# Requirements Document

## Introduction

Claude Code Model Mapper là một VS Code extension cho phép người dùng cấu hình ánh xạ (mapping) giữa các model Claude Code (ví dụ: claude-sonnet-4-6, claude-haiku) sang các model thực tế thông qua một LM proxy/mapper (ví dụ: deepseek/deepseek-v3.2, minimax/minimax-m2.5). Extension cũng cung cấp panel theo dõi real-time các request đang được xử lý, hiển thị thông tin chi tiết về từng request như request ID, model nguồn, model đích, trạng thái và thời gian xử lý.

Claude Code và các plugin/agent của nó tự động chọn model phù hợp với từng loại task: task đơn giản/nhanh dùng claude-haiku, task trung bình dùng claude-sonnet, task phức tạp/reasoning dùng claude-opus. Extension cần ánh xạ từng model Claude đó sang model free/cheap tương ứng theo cấu hình riêng biệt của người dùng — ví dụ: claude-haiku → minimax/minimax-m2.5, claude-sonnet → deepseek/deepseek-v3.2, claude-opus → z-ai/glm5. Mapping hoạt động per-model, không phải global, để khi Claude Code tự động switch model theo task, proxy sẽ tự động ánh xạ sang model free tương ứng.

Mục tiêu chính là tận dụng workflow của Claude Code với các model miễn phí hoặc chi phí thấp hơn thông qua lớp proxy trung gian, đồng thời cung cấp khả năng quan sát (observability) đầy đủ cho người dùng.

## Glossary

- **Extension**: VS Code extension "Claude Code Model Mapper" được mô tả trong tài liệu này
- **Model_Mapper**: Thành phần xử lý việc ánh xạ model nguồn sang model đích theo từng Model_Config riêng biệt
- **Proxy_Server**: Server trung gian nhận request từ Claude Code và chuyển tiếp đến LLM provider thực tế
- **Model_Config**: Cấu hình ánh xạ giữa một model Claude cụ thể (Source_Model) và một model thực tế (Target_Model); mỗi Source_Model có đúng một Model_Config độc lập
- **Source_Model**: Tên model Claude Code gốc mà Claude Code tự động chọn theo loại task (ví dụ: claude-haiku cho task nhanh, claude-sonnet cho task trung bình, claude-opus cho task phức tạp)
- **Target_Model**: Tên model thực tế được dùng để xử lý request tương ứng với Source_Model (ví dụ: minimax/minimax-m2.5, deepseek/deepseek-v3.2, z-ai/glm5)
- **Per_Model_Mapping**: Cơ chế ánh xạ độc lập cho từng Source_Model, cho phép mỗi model Claude được ánh xạ sang một Target_Model khác nhau thay vì dùng một mapping toàn cục
- **Automatic_Model_Selection**: Hành vi của Claude Code khi tự động chọn model phù hợp với từng loại task mà không cần người dùng can thiệp
- **Request**: Một lần gọi API từ Claude Code đến Proxy_Server, bao gồm thông tin Source_Model do Claude Code tự chọn
- **Request_ID**: Định danh duy nhất cho mỗi Request (ví dụ: req-69b7)
- **Traffic_Panel**: Webview panel trong VS Code hiển thị danh sách các Request đang xử lý theo thời gian thực, bao gồm cả Source_Model và Target_Model để người dùng thấy rõ mapping đang hoạt động
- **Config_Panel**: Webview panel hoặc settings UI cho phép người dùng quản lý danh sách Model_Config theo từng Source_Model
- **LM_Provider**: Nhà cung cấp LLM thực tế (ví dụ: DeepSeek, Minimax, ZhipuAI)

## Requirements

### Requirement 1: Quản lý cấu hình ánh xạ model per-model

**User Story:** Là một developer, tôi muốn cấu hình ánh xạ riêng biệt cho từng model Claude sang model thực tế tương ứng, để khi Claude Code tự động chọn model theo loại task, proxy sẽ tự động dùng đúng model free/cheap phù hợp với task đó.

#### Acceptance Criteria

1. THE Extension SHALL cung cấp giao diện để người dùng thêm, sửa và xóa các Model_Config theo từng Source_Model riêng biệt.
2. WHEN người dùng thêm một Model_Config, THE Extension SHALL yêu cầu nhập Source_Model và Target_Model.
3. THE Extension SHALL hỗ trợ cấu hình đồng thời nhiều Per_Model_Mapping độc lập, ví dụ: claude-haiku → minimax/minimax-m2.5, claude-sonnet → deepseek/deepseek-v3.2, claude-opus → z-ai/glm5.
4. THE Extension SHALL đảm bảo mỗi Source_Model chỉ có đúng một Target_Model trong cấu hình (không cho phép trùng lặp Source_Model).
5. WHEN người dùng lưu một Model_Config, THE Extension SHALL lưu cấu hình vào VS Code settings (workspace hoặc global).
6. WHEN người dùng xóa một Model_Config, THE Extension SHALL xóa ánh xạ đó khỏi cấu hình và dừng áp dụng nó cho các Request mới.
7. IF Source_Model hoặc Target_Model bị để trống, THEN THE Extension SHALL hiển thị thông báo lỗi validation và từ chối lưu Model_Config đó.
8. THE Extension SHALL hiển thị danh sách tất cả Model_Config hiện tại trong Config_Panel, nhóm theo Source_Model để dễ nhận biết mapping nào đang hoạt động.

### Requirement 2: Khởi động và quản lý Proxy Server

**User Story:** Là một developer, tôi muốn extension tự động khởi động một proxy server cục bộ, để Claude Code có thể gửi request qua proxy mà không cần cấu hình thủ công phức tạp.

#### Acceptance Criteria

1. WHEN Extension được kích hoạt, THE Proxy_Server SHALL khởi động trên một cổng (port) cục bộ có thể cấu hình được.
2. THE Extension SHALL hiển thị địa chỉ và cổng của Proxy_Server đang chạy trong status bar của VS Code.
3. WHEN Proxy_Server khởi động thành công, THE Extension SHALL thông báo cho người dùng địa chỉ endpoint để cấu hình vào Claude Code.
4. IF cổng đã được sử dụng bởi tiến trình khác, THEN THE Proxy_Server SHALL thử cổng tiếp theo trong dải cổng đã cấu hình và thông báo cổng thực tế đang dùng.
5. WHEN Extension bị hủy kích hoạt (deactivate), THE Proxy_Server SHALL dừng và giải phóng cổng.
6. WHILE Proxy_Server đang chạy, THE Extension SHALL duy trì kết nối và tự động khởi động lại nếu Proxy_Server bị crash.

### Requirement 3: Xử lý và ánh xạ request theo Per_Model_Mapping

**User Story:** Là một developer, tôi muốn proxy server tự động thay thế model trong mỗi request dựa trên Per_Model_Mapping tương ứng, để khi Claude Code tự động switch model theo task (haiku/sonnet/opus), proxy ánh xạ đúng sang model free tương ứng đã cấu hình.

#### Acceptance Criteria

1. WHEN Proxy_Server nhận một Request từ Claude Code, THE Model_Mapper SHALL tra cứu Source_Model trong danh sách Model_Config theo cơ chế Per_Model_Mapping.
2. WHEN Source_Model khớp với một Model_Config, THE Model_Mapper SHALL thay thế tên model trong Request bằng Target_Model tương ứng trước khi chuyển tiếp đến LM_Provider.
3. IF Source_Model không khớp với bất kỳ Model_Config nào, THEN THE Proxy_Server SHALL chuyển tiếp Request đến LM_Provider với model gốc không thay đổi.
4. THE Model_Mapper SHALL xử lý đồng thời nhiều Request với các Source_Model khác nhau, mỗi Request được ánh xạ độc lập theo Per_Model_Mapping của Source_Model đó.
5. THE Proxy_Server SHALL chuyển tiếp toàn bộ headers, body và authentication token của Request gốc đến LM_Provider (ngoại trừ trường model đã được thay thế).
6. WHEN LM_Provider trả về response, THE Proxy_Server SHALL chuyển tiếp response đó về cho Claude Code mà không thay đổi nội dung.
7. THE Proxy_Server SHALL hỗ trợ streaming response (Server-Sent Events) từ LM_Provider về Claude Code.

### Requirement 4: Theo dõi request real-time trong Traffic Panel

**User Story:** Là một developer, tôi muốn xem danh sách các request đang xử lý theo thời gian thực với thông tin rõ ràng về model nào Claude Code yêu cầu (Source_Model) và model nào thực sự xử lý (Target_Model), để tôi có thể quan sát Per_Model_Mapping đang hoạt động đúng không.

#### Acceptance Criteria

1. THE Traffic_Panel SHALL hiển thị danh sách các Request đang và đã được xử lý trong phiên làm việc hiện tại.
2. WHEN một Request mới đến Proxy_Server, THE Traffic_Panel SHALL thêm một dòng mới hiển thị: Request_ID, Source_Model (model Claude Code yêu cầu), Target_Model (model thực sự xử lý), trạng thái ban đầu và thời điểm bắt đầu.
3. THE Traffic_Panel SHALL hiển thị Source_Model và Target_Model trên cùng một dòng để người dùng thấy rõ mapping đang được áp dụng cho từng Request.
4. WHEN trạng thái của một Request thay đổi, THE Traffic_Panel SHALL cập nhật dòng tương ứng trong vòng 500ms.
5. THE Traffic_Panel SHALL hiển thị các trạng thái sau cho mỗi Request: "Đang chờ hàng" (queued), "Đang xử lý" (processing), "Hoàn thành" (completed), "Lỗi" (error).
6. THE Traffic_Panel SHALL hiển thị thời gian xử lý (duration) tính từ lúc Request được nhận đến khi hoàn thành hoặc lỗi.
7. WHERE người dùng bật tùy chọn tự động cuộn, THE Traffic_Panel SHALL tự động cuộn xuống dòng mới nhất khi có Request mới.
8. THE Traffic_Panel SHALL cho phép người dùng xóa lịch sử các Request đã hoàn thành hoặc lỗi.
9. THE Traffic_Panel SHALL giới hạn hiển thị tối đa 200 Request gần nhất để tránh ảnh hưởng hiệu suất.

### Requirement 5: Cấu hình LM Provider endpoint

**User Story:** Là một developer, tôi muốn cấu hình endpoint của LM Provider, để proxy server biết nơi chuyển tiếp các request sau khi ánh xạ model.

#### Acceptance Criteria

1. THE Extension SHALL cho phép người dùng cấu hình base URL của LM_Provider (ví dụ: `https://api.openrouter.ai/api/v1`).
2. THE Extension SHALL cho phép người dùng cấu hình API key cho LM_Provider.
3. WHEN người dùng thay đổi cấu hình LM_Provider, THE Proxy_Server SHALL áp dụng cấu hình mới cho các Request tiếp theo mà không cần khởi động lại.
4. IF base URL của LM_Provider không hợp lệ (không phải HTTP/HTTPS URL), THEN THE Extension SHALL hiển thị thông báo lỗi validation.
5. THE Extension SHALL lưu API key vào VS Code SecretStorage thay vì settings thông thường để bảo mật.

### Requirement 6: Hỗ trợ Automatic Model Selection của Claude Code

**User Story:** Là một developer, tôi muốn proxy tự động xử lý việc Claude Code switch model theo task mà không cần tôi can thiệp, để workflow tự động của Claude Code (haiku cho task nhanh, sonnet cho task trung bình, opus cho task phức tạp) vẫn hoạt động đúng với các model free tương ứng.

#### Acceptance Criteria

1. THE Proxy_Server SHALL xử lý đúng các Request từ Automatic_Model_Selection của Claude Code, trong đó Source_Model thay đổi tự động theo từng task mà không cần người dùng can thiệp.
2. WHEN Claude Code gửi Request với Source_Model là một model haiku (ví dụ: claude-haiku-*), THE Model_Mapper SHALL ánh xạ sang Target_Model đã cấu hình cho model haiku đó.
3. WHEN Claude Code gửi Request với Source_Model là một model sonnet (ví dụ: claude-sonnet-*), THE Model_Mapper SHALL ánh xạ sang Target_Model đã cấu hình cho model sonnet đó.
4. WHEN Claude Code gửi Request với Source_Model là một model opus (ví dụ: claude-opus-*), THE Model_Mapper SHALL ánh xạ sang Target_Model đã cấu hình cho model opus đó.
5. THE Model_Mapper SHALL hỗ trợ khớp Source_Model theo prefix (ví dụ: "claude-haiku" khớp với "claude-haiku-4-5-20251001") khi không có khớp chính xác trong danh sách Model_Config.
6. THE Extension SHALL cung cấp template cấu hình mặc định gợi ý mapping cho ba nhóm model chính: haiku (task nhanh/đơn giản), sonnet (task trung bình), opus (task phức tạp/reasoning).

### Requirement 7: Tích hợp với VS Code UI

**User Story:** Là một developer, tôi muốn extension tích hợp tự nhiên vào VS Code, để tôi có thể truy cập các tính năng mà không cần rời khỏi editor.

#### Acceptance Criteria

1. THE Extension SHALL đăng ký một Activity Bar icon để mở sidebar chứa Config_Panel và Traffic_Panel.
2. THE Extension SHALL hiển thị trạng thái Proxy_Server (đang chạy / đã dừng / lỗi) trong VS Code status bar.
3. THE Extension SHALL cung cấp các VS Code commands có thể truy cập qua Command Palette: khởi động proxy, dừng proxy, mở Traffic Panel, mở Config Panel.
4. WHEN Proxy_Server gặp lỗi không thể tự phục hồi, THE Extension SHALL hiển thị thông báo lỗi (error notification) trong VS Code với tùy chọn xem log chi tiết.
5. THE Extension SHALL hỗ trợ cả chế độ light theme và dark theme của VS Code trong tất cả các panel.
