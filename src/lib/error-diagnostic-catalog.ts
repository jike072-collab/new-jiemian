export type ErrorDiagnosticCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_DISABLED"
  | "PROVIDER_MISSING_ENDPOINT"
  | "PROVIDER_INVALID_ENDPOINT"
  | "PROVIDER_MISSING_API_KEY"
  | "PROVIDER_HEALTH_CHECK_FAILED"
  | "MODEL_MISSING_IMAGE"
  | "MODEL_MISSING_IMAGE_EDIT"
  | "MODEL_MISSING_VIDEO"
  | "MODEL_MISSING_IMAGE_UPSCALE"
  | "MODEL_MISSING_VIDEO_UPSCALE"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "INPUT_MISSING_PROMPT"
  | "INPUT_MISSING_IMAGE"
  | "INPUT_INVALID_IMAGE"
  | "INPUT_INVALID_PARAMETERS"
  | "INPUT_FILE_TOO_LARGE"
  | "INPUT_UNSUPPORTED_FORMAT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_ERROR"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_FORBIDDEN"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_UPSTREAM_4XX"
  | "PROVIDER_UPSTREAM_5XX"
  | "PROVIDER_NON_JSON_RESPONSE"
  | "PROVIDER_BAD_RESPONSE"
  | "PROVIDER_EMPTY_RESPONSE"
  | "TASK_CREATE_FAILED"
  | "TASK_POLL_FAILED"
  | "TASK_FAILED"
  | "TASK_TIMEOUT"
  | "TASK_CANCELLED"
  | "TASK_UNKNOWN_STATUS"
  | "LIBRARY_SAVE_FAILED"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_READ_FAILED"
  | "UPLOAD_WRITE_FAILED"
  | "RESULT_ASSET_MISSING"
  | "INTERNAL_ERROR"
  | "UNKNOWN_ERROR";

export type ErrorDiagnosticCategory =
  | "configuration"
  | "model"
  | "input"
  | "network"
  | "upstream"
  | "task"
  | "storage"
  | "system"
  | "unknown";

export type ErrorDiagnosticMeta = {
  code: ErrorDiagnosticCode;
  category: ErrorDiagnosticCategory;
  message: string;
  action: string;
  adminNote: string;
  retryable: boolean;
  status: number;
};

export type ErrorDiagnostic = {
  code: ErrorDiagnosticCode;
  category: ErrorDiagnosticCategory;
  message: string;
  technicalMessage: string;
  retryable: boolean;
  requestId: string;
  occurredAt: string;
  status: number;
  upstreamStatus?: number;
  providerId?: string;
  model?: string;
  action: string;
  adminNote: string;
  safeDetails: Record<string, unknown>;
};

export const errorDiagnosticCatalog: Record<ErrorDiagnosticCode, ErrorDiagnosticMeta> = {
  PROVIDER_NOT_CONFIGURED: {
    code: "PROVIDER_NOT_CONFIGURED",
    category: "configuration",
    message: "当前功能还没有配置可用供应商。",
    action: "请联系管理员完成供应商配置后再试。",
    adminNote: "Check provider kind, enabled state, endpoint, model, and API key.",
    retryable: false,
    status: 400,
  },
  PROVIDER_DISABLED: {
    code: "PROVIDER_DISABLED",
    category: "configuration",
    message: "当前供应商已停用。",
    action: "请切换到可用模型，或联系管理员启用供应商。",
    adminNote: "The selected provider exists but is disabled.",
    retryable: false,
    status: 400,
  },
  PROVIDER_MISSING_ENDPOINT: {
    code: "PROVIDER_MISSING_ENDPOINT",
    category: "configuration",
    message: "供应商接口地址未填写。",
    action: "请联系管理员补充接口地址。",
    adminNote: "Provider apiUrl is empty.",
    retryable: false,
    status: 400,
  },
  PROVIDER_INVALID_ENDPOINT: {
    code: "PROVIDER_INVALID_ENDPOINT",
    category: "configuration",
    message: "供应商接口地址无效。",
    action: "请联系管理员检查接口地址是否为 http 或 https URL。",
    adminNote: "Provider endpoint cannot be parsed or uses an unsupported protocol.",
    retryable: false,
    status: 400,
  },
  PROVIDER_MISSING_API_KEY: {
    code: "PROVIDER_MISSING_API_KEY",
    category: "configuration",
    message: "供应商 API Key 未配置。",
    action: "请联系管理员补充 API Key。",
    adminNote: "Provider apiKey is empty or placeholder-like.",
    retryable: false,
    status: 400,
  },
  PROVIDER_HEALTH_CHECK_FAILED: {
    code: "PROVIDER_HEALTH_CHECK_FAILED",
    category: "configuration",
    message: "供应商健康检查未通过。",
    action: "请联系管理员查看供应商连接检查。",
    adminNote: "Provider health check reported a blocking issue.",
    retryable: true,
    status: 503,
  },
  MODEL_MISSING_IMAGE: {
    code: "MODEL_MISSING_IMAGE",
    category: "model",
    message: "图片模型未配置。",
    action: "请联系管理员选择可用图片模型。",
    adminNote: "Image provider model is empty.",
    retryable: false,
    status: 400,
  },
  MODEL_MISSING_IMAGE_EDIT: {
    code: "MODEL_MISSING_IMAGE_EDIT",
    category: "model",
    message: "图片编辑模型未配置。",
    action: "请联系管理员选择可用图片编辑模型。",
    adminNote: "Image edit provider model is empty.",
    retryable: false,
    status: 400,
  },
  MODEL_MISSING_VIDEO: {
    code: "MODEL_MISSING_VIDEO",
    category: "model",
    message: "视频模型未配置。",
    action: "请联系管理员选择可用视频模型。",
    adminNote: "Video provider model is empty.",
    retryable: false,
    status: 400,
  },
  MODEL_MISSING_IMAGE_UPSCALE: {
    code: "MODEL_MISSING_IMAGE_UPSCALE",
    category: "model",
    message: "图片高清模型或服务未配置。",
    action: "请联系管理员检查图片高清供应商配置。",
    adminNote: "Image upscale service ID/model is missing.",
    retryable: false,
    status: 400,
  },
  MODEL_MISSING_VIDEO_UPSCALE: {
    code: "MODEL_MISSING_VIDEO_UPSCALE",
    category: "model",
    message: "视频高清模型或空间未配置。",
    action: "请联系管理员检查视频高清供应商配置。",
    adminNote: "Video upscale space/model is missing.",
    retryable: false,
    status: 400,
  },
  MODEL_NOT_FOUND: {
    code: "MODEL_NOT_FOUND",
    category: "model",
    message: "供应商未找到所选模型。",
    action: "请切换模型，或联系管理员更新模型配置。",
    adminNote: "Configured model is not present in the provider model list.",
    retryable: false,
    status: 400,
  },
  MODEL_UNAVAILABLE: {
    code: "MODEL_UNAVAILABLE",
    category: "model",
    message: "所选模型当前不可用。",
    action: "请稍后重试，或切换到其他模型。",
    adminNote: "Provider reports the selected model as unavailable.",
    retryable: true,
    status: 503,
  },
  INPUT_MISSING_PROMPT: {
    code: "INPUT_MISSING_PROMPT",
    category: "input",
    message: "请输入提示词。",
    action: "补充提示词后再提交。",
    adminNote: "Prompt is empty after trimming.",
    retryable: false,
    status: 400,
  },
  INPUT_MISSING_IMAGE: {
    code: "INPUT_MISSING_IMAGE",
    category: "input",
    message: "请上传所需图片。",
    action: "上传图片后再提交。",
    adminNote: "A required image input is missing.",
    retryable: false,
    status: 400,
  },
  INPUT_INVALID_IMAGE: {
    code: "INPUT_INVALID_IMAGE",
    category: "input",
    message: "图片文件无效。",
    action: "请重新上传 PNG、JPEG 或 WebP 图片。",
    adminNote: "Uploaded image is unreadable or invalid.",
    retryable: false,
    status: 400,
  },
  INPUT_INVALID_PARAMETERS: {
    code: "INPUT_INVALID_PARAMETERS",
    category: "input",
    message: "提交参数不完整或无效。",
    action: "请检查页面参数后重新提交。",
    adminNote: "Request parameters failed local validation.",
    retryable: false,
    status: 400,
  },
  INPUT_FILE_TOO_LARGE: {
    code: "INPUT_FILE_TOO_LARGE",
    category: "input",
    message: "上传文件过大。",
    action: "请压缩文件或改用更小的文件。",
    adminNote: "Uploaded file exceeds the local size limit.",
    retryable: false,
    status: 413,
  },
  INPUT_UNSUPPORTED_FORMAT: {
    code: "INPUT_UNSUPPORTED_FORMAT",
    category: "input",
    message: "文件格式不受支持。",
    action: "请上传当前功能支持的文件格式。",
    adminNote: "Uploaded media type is not accepted by this tool.",
    retryable: false,
    status: 415,
  },
  PROVIDER_TIMEOUT: {
    code: "PROVIDER_TIMEOUT",
    category: "network",
    message: "供应商请求超时。",
    action: "可以稍后重试；如果持续出现，请联系管理员检查供应商状态。",
    adminNote: "Fetch timed out before the provider returned a response.",
    retryable: true,
    status: 504,
  },
  PROVIDER_NETWORK_ERROR: {
    code: "PROVIDER_NETWORK_ERROR",
    category: "network",
    message: "连接供应商失败。",
    action: "可以稍后重试；如果持续出现，请联系管理员检查网络和接口地址。",
    adminNote: "Network request failed before receiving an upstream status.",
    retryable: true,
    status: 503,
  },
  PROVIDER_AUTH_FAILED: {
    code: "PROVIDER_AUTH_FAILED",
    category: "upstream",
    message: "供应商认证失败。",
    action: "请联系管理员检查 API Key。",
    adminNote: "Upstream returned 401.",
    retryable: false,
    status: 502,
  },
  PROVIDER_FORBIDDEN: {
    code: "PROVIDER_FORBIDDEN",
    category: "upstream",
    message: "供应商拒绝了本次请求。",
    action: "请联系管理员确认账号权限、模型权限或区域权限。",
    adminNote: "Upstream returned 403.",
    retryable: false,
    status: 502,
  },
  PROVIDER_RATE_LIMITED: {
    code: "PROVIDER_RATE_LIMITED",
    category: "upstream",
    message: "供应商请求频率过高。",
    action: "请稍后重试。",
    adminNote: "Upstream returned 429.",
    retryable: true,
    status: 429,
  },
  PROVIDER_BAD_REQUEST: {
    code: "PROVIDER_BAD_REQUEST",
    category: "upstream",
    message: "供应商认为请求参数无效。",
    action: "请调整输入或联系管理员检查模型参数。",
    adminNote: "Upstream returned 400.",
    retryable: false,
    status: 502,
  },
  PROVIDER_UPSTREAM_4XX: {
    code: "PROVIDER_UPSTREAM_4XX",
    category: "upstream",
    message: "供应商拒绝了请求。",
    action: "请检查输入；如果持续出现，请联系管理员查看供应商配置。",
    adminNote: "Upstream returned a non-specific 4xx status.",
    retryable: false,
    status: 502,
  },
  PROVIDER_UPSTREAM_5XX: {
    code: "PROVIDER_UPSTREAM_5XX",
    category: "upstream",
    message: "供应商服务暂时不可用。",
    action: "请稍后重试。",
    adminNote: "Upstream returned a 5xx status.",
    retryable: true,
    status: 502,
  },
  PROVIDER_NON_JSON_RESPONSE: {
    code: "PROVIDER_NON_JSON_RESPONSE",
    category: "upstream",
    message: "供应商返回了非 JSON 响应。",
    action: "请稍后重试；如果持续出现，请联系管理员检查接口地址。",
    adminNote: "Upstream content could not be parsed as JSON.",
    retryable: true,
    status: 502,
  },
  PROVIDER_BAD_RESPONSE: {
    code: "PROVIDER_BAD_RESPONSE",
    category: "upstream",
    message: "供应商响应格式异常。",
    action: "请稍后重试；如果持续出现，请联系管理员检查供应商适配。",
    adminNote: "Upstream JSON shape did not match expected output fields.",
    retryable: true,
    status: 502,
  },
  PROVIDER_EMPTY_RESPONSE: {
    code: "PROVIDER_EMPTY_RESPONSE",
    category: "upstream",
    message: "供应商返回了空响应。",
    action: "请稍后重试。",
    adminNote: "Upstream response body was empty.",
    retryable: true,
    status: 502,
  },
  TASK_CREATE_FAILED: {
    code: "TASK_CREATE_FAILED",
    category: "task",
    message: "任务创建失败。",
    action: "请稍后重试。",
    adminNote: "Provider did not create a usable async task.",
    retryable: true,
    status: 502,
  },
  TASK_POLL_FAILED: {
    code: "TASK_POLL_FAILED",
    category: "task",
    message: "任务状态查询失败。",
    action: "请稍后刷新任务状态。",
    adminNote: "Polling the provider task endpoint failed.",
    retryable: true,
    status: 502,
  },
  TASK_FAILED: {
    code: "TASK_FAILED",
    category: "task",
    message: "供应商任务处理失败。",
    action: "请调整输入后重试，或联系管理员查看供应商任务错误。",
    adminNote: "Provider task reached a failed state.",
    retryable: false,
    status: 502,
  },
  TASK_TIMEOUT: {
    code: "TASK_TIMEOUT",
    category: "task",
    message: "任务处理超时。",
    action: "请稍后重试或刷新任务状态。",
    adminNote: "Task exceeded expected processing time.",
    retryable: true,
    status: 504,
  },
  TASK_CANCELLED: {
    code: "TASK_CANCELLED",
    category: "task",
    message: "任务已取消。",
    action: "请重新提交任务。",
    adminNote: "Provider task was cancelled.",
    retryable: false,
    status: 409,
  },
  TASK_UNKNOWN_STATUS: {
    code: "TASK_UNKNOWN_STATUS",
    category: "task",
    message: "任务状态无法识别。",
    action: "请稍后刷新；如果持续出现，请联系管理员。",
    adminNote: "Provider task status did not match known states.",
    retryable: true,
    status: 502,
  },
  LIBRARY_SAVE_FAILED: {
    code: "LIBRARY_SAVE_FAILED",
    category: "storage",
    message: "作品保存失败。",
    action: "请稍后重试；如果持续出现，请联系管理员检查存储。",
    adminNote: "Generated output could not be persisted to the library.",
    retryable: true,
    status: 500,
  },
  UPLOAD_NOT_FOUND: {
    code: "UPLOAD_NOT_FOUND",
    category: "storage",
    message: "上传文件不存在。",
    action: "请重新上传文件。",
    adminNote: "The expected upload file was not found.",
    retryable: false,
    status: 404,
  },
  UPLOAD_READ_FAILED: {
    code: "UPLOAD_READ_FAILED",
    category: "storage",
    message: "上传文件读取失败。",
    action: "请重新上传文件。",
    adminNote: "Uploaded file could not be read.",
    retryable: true,
    status: 400,
  },
  UPLOAD_WRITE_FAILED: {
    code: "UPLOAD_WRITE_FAILED",
    category: "storage",
    message: "上传文件写入失败。",
    action: "请稍后重试；如果持续出现，请联系管理员检查存储。",
    adminNote: "Upload could not be written to runtime storage.",
    retryable: true,
    status: 500,
  },
  RESULT_ASSET_MISSING: {
    code: "RESULT_ASSET_MISSING",
    category: "storage",
    message: "结果文件暂不可用。",
    action: "请稍后刷新，或联系管理员检查结果文件。",
    adminNote: "Library item points to a missing or unavailable result asset.",
    retryable: true,
    status: 404,
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    category: "system",
    message: "系统处理失败。",
    action: "请稍后重试；如果持续出现，请联系管理员。",
    adminNote: "Unexpected local server failure.",
    retryable: true,
    status: 500,
  },
  UNKNOWN_ERROR: {
    code: "UNKNOWN_ERROR",
    category: "unknown",
    message: "发生未知错误。",
    action: "请稍后重试；如果持续出现，请联系管理员。",
    adminNote: "Fallback for uncategorized failures.",
    retryable: true,
    status: 500,
  },
};

export function errorDiagnosticMeta(code: ErrorDiagnosticCode): ErrorDiagnosticMeta {
  return errorDiagnosticCatalog[code];
}
