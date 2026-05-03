use futures::{Stream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::time::Duration;

/// Retry an async operation with exponential backoff for transient errors.
/// Retries on connection errors and HTTP 502/503/504.
async fn with_retry<T, F, Fut>(
    operation: F,
    max_retries: u32,
) -> Result<T, LlmError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, LlmError>>,
{
    let mut last_error = None;
    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = Duration::from_millis(500 * (1 << (attempt - 1)));
            tracing::warn!(
                "[LLM Retry] Attempt {} failed, retrying in {:?}...",
                attempt,
                delay
            );
            tokio::time::sleep(delay).await;
        }
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                let should_retry = match &e {
                    LlmError::ConnectionError(_) => true,
                    LlmError::ApiError(msg) => {
                        msg.contains("502")
                            || msg.contains("503")
                            || msg.contains("504")
                    }
                    _ => false,
                };
                if !should_retry || attempt == max_retries {
                    return Err(e);
                }
                last_error = Some(e);
            }
        }
    }
    Err(last_error.unwrap_or(LlmError::ApiError(
        "Retry exhausted".to_string(),
    )))
}

/// Retrieval result for source-grounded summary
#[derive(Debug, Clone)]
pub struct RetrievalResult {
    pub chunk_id: String,
    pub content: String,
    pub page_start: i64,
    pub page_end: i64,
}

/// Stream item for source-grounded summary streaming
/// Replaces raw SseEvent with structured data to avoid fragile Debug parsing
#[derive(Debug, Clone)]
pub enum SummaryStreamItem {
    Text(String),
    Done,
}

/// LLM Client for connecting to LM Studio (OpenAI-compatible API)
pub struct LlmClient {
    client: Client,
    base_url: String,
    model: String,
    api_key: String,
}

/// OpenAI-compatible chat message
#[derive(Debug, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn new(role: &str, content: &str) -> Self {
        Self {
            role: role.to_string(),
            content: content.to_string(),
        }
    }
}

/// OpenAI-compatible request structure
#[derive(Debug, Serialize, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

/// OpenAI-compatible response structure
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageContent,
}

#[derive(Debug, Deserialize)]
struct ChatMessageContent {
    content: String,
}

/// Streaming response structure (SSE from OpenAI-compatible API)
#[derive(Debug, Deserialize)]
struct ChatResponseStream {
    choices: Vec<ChatChoiceStream>,
}

#[derive(Debug, Deserialize)]
struct ChatChoiceStream {
    delta: ChatDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatDelta {
    content: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    reasoning_content: Option<String>,
}

impl ChatDelta {
    fn content(&self) -> String {
        self.content.clone().unwrap_or_default()
    }
}

/// Concept extracted from a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedConcept {
    pub name: String,
    pub native_term: Option<String>, // Original term from the source text, used for retrieval
    pub description: String,
    pub examples: Vec<String>,
    pub category: Option<String>,
    pub page_number: Option<i32>,
}

/// Relation between concepts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedRelation {
    pub source_name: String,
    pub target_name: String,
    pub relation_type: String,
    pub explanation: String,
}

/// Response from concept extraction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptExtractionResponse {
    pub concepts: Vec<ExtractedConcept>,
    pub relations: Vec<ExtractedRelation>,
    pub language: String,
}

/// Citation for a source-grounded summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub index: usize,
    pub chunk_id: String,
    pub page_start: i64,
    pub page_end: i64,
    pub excerpt: String,
}

/// Source-grounded summary with citations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceGroundedSummary {
    pub summary: String,
    pub citations: Vec<Citation>,
}

/// Request to generate a source-grounded summary
#[derive(Debug, Clone)]
pub struct SourceGroundedSummaryRequest {
    pub node_name: String,
    pub node_description: Option<String>,
    pub retrieval_results: Vec<RetrievalResult>,
}

impl LlmClient {
    /// Create a new LLM client connecting to the specified URL
    pub fn new(base_url: &str, model: &str, api_key: &str) -> Result<Self, LlmError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .http1_only()
            .build()
            .map_err(|e| LlmError::ConnectionError(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            api_key: api_key.to_string(),
        })
    }

    /// Extract concepts from a chunk of text
    pub async fn extract_concepts(
        &self,
        chunk_id: &str,
        chunk_content: &str,
        language: &str,
    ) -> Result<ConceptExtractionResponse, LlmError> {
        let system_prompt = build_system_prompt(language);
        let user_prompt = build_user_prompt(chunk_content, chunk_id, language);

        tracing::trace!("[{}] System prompt length: {}", chunk_id, system_prompt.len());
        tracing::trace!("[{}] User prompt length: {} chars", chunk_id, user_prompt.len());

        // Use model from client
        let model = self.model.clone();
        let model_for_log = model.clone();
        tracing::debug!("[{}] Using model: {}", chunk_id, model_for_log);

        let request = ChatRequest {
            model,
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_prompt,
                },
            ],
            temperature: 0.3,
            stream: None,
        };

        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!("[LM Client] Sending request to {}", url);
        tracing::trace!("[LM Client] Request: {:?}", request);

        let client = self.client.clone();
        let response = with_retry(
            || {
                let client = client.clone();
                let url = url.clone();
                let request = request.clone();
                async move {
                    let resp = client
                        .post(&url)
                        .header("Authorization", format!("Bearer {}", self.api_key))
                        .json(&request)
                        .send()
                        .await
                        .map_err(|e| {
                            tracing::error!("[LM Client] Connection error: {}", e);
                            LlmError::ConnectionError(e.to_string())
                        })?;

                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        tracing::error!("[LM Client] API error {}: {}", status, body);
                        return Err(LlmError::ApiError(format!(
                            "API error {}: {}",
                            status, body
                        )));
                    }
                    Ok(resp)
                }
            },
            3,
        )
        .await?;

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| {
                tracing::error!("[LM Client] Parse error: {}", e);
                LlmError::ParseError(e.to_string())
            })?;

        // Extract content from the first choice
        let content = chat_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or(LlmError::EmptyResponse)?;

        tracing::trace!("[LM Client] Raw response content: {}", content);

        parse_extraction_response(&content, language)
    }

    /// Generate a source-grounded summary with citations from retrieval results
    ///
    /// # Arguments
    /// * `request` - The summary request containing node info and retrieval results
    ///
    /// # Returns
    /// * `Result<SourceGroundedSummary, LlmError>` - The generated summary with citations
    pub async fn generate_source_grounded_summary(
        &self,
        request: &SourceGroundedSummaryRequest,
    ) -> Result<SourceGroundedSummary, LlmError> {
        // Build NotebookLM-style prompt
        let prompt = build_summary_prompt(request);

        // Use model from client
        let model = self.model.clone();
        tracing::debug!("[SourceGroundedSummary] Using model: {}", model);

        let chat_request = ChatRequest {
            model: model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            temperature: 0.3,
            stream: None,
        };

        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!("[SourceGroundedSummary] Sending request to {}", url);

        let client = self.client.clone();
        let response = with_retry(
            || {
                let client = client.clone();
                let url = url.clone();
                let chat_request = chat_request.clone();
                async move {
                    let resp = client
                        .post(&url)
                        .header("Authorization", format!("Bearer {}", self.api_key))
                        .json(&chat_request)
                        .send()
                        .await
                        .map_err(|e| {
                            tracing::error!("[SourceGroundedSummary] Connection error: {}", e);
                            LlmError::ConnectionError(e.to_string())
                        })?;

                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        tracing::error!("[SourceGroundedSummary] API error {}: {}", status, body);
                        return Err(LlmError::ApiError(format!(
                            "API error {}: {}",
                            status, body
                        )));
                    }
                    Ok(resp)
                }
            },
            3,
        )
        .await?;

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| {
                tracing::error!("[SourceGroundedSummary] Parse error: {}", e);
                LlmError::ParseError(e.to_string())
            })?;

        // Extract content from the first choice
        let content = chat_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or(LlmError::EmptyResponse)?;

        tracing::trace!("[SourceGroundedSummary] Raw response: {}", content);

        // Extract citations from the summary text using [Source: X] pattern
        let mut seen_indices = std::collections::HashSet::new();
        let mut citations = Vec::new();

        for caps in crate::utils::CITATION_REGEX.captures_iter(&content) {
            if let Ok(idx) = caps[1].parse::<usize>() {
                if idx > 0 && idx <= request.retrieval_results.len() && seen_indices.insert(idx) {
                    let result = &request.retrieval_results[idx - 1];
                    let excerpt = result.content.chars().take(200).collect::<String>();
                    citations.push(Citation {
                        index: idx,
                        chunk_id: result.chunk_id.clone(),
                        page_start: result.page_start,
                        page_end: result.page_end,
                        excerpt,
                    });
                }
            }
        }

        citations.sort_by_key(|c| c.index);

        tracing::info!(
            "[SourceGroundedSummary] Generated summary with {} citations",
            citations.len()
        );

        Ok(SourceGroundedSummary {
            summary: content.trim().to_string(),
            citations,
        })
    }

    /// Simple non-streaming chat completion, returns the response text.
    /// Used for HyDE passage generation and other single-turn LLM calls.
    pub async fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        temperature: f32,
    ) -> Result<String, LlmError> {
        let chat_request = ChatRequest {
            model: self.model.clone(),
            messages,
            temperature,
            stream: None,
        };

        let url = format!("{}/chat/completions", self.base_url);

        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let response = with_retry(
            || {
                let client = client.clone();
                let url = url.clone();
                let api_key = api_key.clone();
                let chat_request = chat_request.clone();
                async move {
                    let resp = client
                        .post(&url)
                        .header("Authorization", format!("Bearer {}", api_key))
                        .json(&chat_request)
                        .send()
                        .await
                        .map_err(|e| {
                            tracing::error!("[ChatCompletion] Connection error: {}", e);
                            LlmError::ConnectionError(e.to_string())
                        })?;

                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        tracing::error!("[ChatCompletion] API error {}: {}", status, body);
                        return Err(LlmError::ApiError(format!("API error {}: {}", status, body)));
                    }
                    Ok(resp)
                }
            },
            3,
        )
        .await?;

        let chat_response: ChatResponse = response.json().await.map_err(|e| {
            tracing::error!("[ChatCompletion] Parse error: {}", e);
            LlmError::ParseError(e.to_string())
        })?;

        chat_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or(LlmError::EmptyResponse)
    }

    /// Generate a chat response with true streaming token output
    ///
    /// Returns a stream of SummaryStreamItem (text tokens and done signals)
    /// Note: Takes `self` by ownership to avoid lifetime issues with async_stream
    pub fn into_chat_stream(
        self,
        messages: Vec<ChatMessage>,
    ) -> Pin<Box<dyn Stream<Item = Result<SummaryStreamItem, LlmError>> + Send + 'static>> {
        let model = self.model.clone();
        let base_url = self.base_url.clone();

        Box::pin(async_stream::stream! {
            let chat_request = ChatRequest {
                model: model.clone(),
                messages,
                temperature: 0.3,
                stream: Some(true),
            };

            let url = format!("{}/chat/completions", base_url);
            tracing::debug!("[ChatStream] Sending streaming request to {}", url);

            // Retry transient errors on the initial request
            let client = self.client.clone();
            let api_key = self.api_key.clone();
            let response = match with_retry(
                || {
                    let client = client.clone();
                    let url = url.clone();
                    let api_key = api_key.clone();
                    let chat_request = chat_request.clone();
                    async move {
                        let resp = client
                            .post(&url)
                            .header("Authorization", format!("Bearer {}", api_key))
                            .json(&chat_request)
                            .send()
                            .await
                            .map_err(|e| {
                                tracing::error!("[ChatStream] Connection error: {}", e);
                                LlmError::ConnectionError(e.to_string())
                            })?;

                        if !resp.status().is_success() {
                            let status = resp.status();
                            let body = resp.text().await.unwrap_or_default();
                            tracing::error!("[ChatStream] API error {}: {}", status, body);
                            return Err(LlmError::ApiError(format!(
                                "API error {}: {}",
                                status, body
                            )));
                        }
                        Ok(resp)
                    }
                },
                3,
            )
            .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    yield Err(e);
                    return;
                }
            };

            // Stream tokens as they arrive
            let mut stream = response.bytes_stream();
            let mut current_line: Vec<u8> = Vec::new();

            while let Some(item) = stream.next().await {
                let chunk = match item {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        tracing::error!("[ChatStream] Read error: {}", e);
                        yield Err(LlmError::ConnectionError(e.to_string()));
                        return;
                    }
                };

                for byte in chunk {
                    if byte == b'\n' {
                        let line = String::from_utf8_lossy(&current_line).trim().to_string();
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" {
                                tracing::debug!("[ChatStream] Received [DONE], ending stream");
                                yield Ok(SummaryStreamItem::Done);
                                return;
                            }
                            match serde_json::from_str::<ChatResponseStream>(data) {
                                Ok(resp) => {
                                    for choice in resp.choices {
                                        if choice.finish_reason.as_deref() == Some("stop") {
                                            tracing::debug!("[ChatStream] Received stop signal");
                                            yield Ok(SummaryStreamItem::Done);
                                            return;
                                        }
                                        let content = choice.delta.content();
                                        if !content.is_empty() {
                                            yield Ok(SummaryStreamItem::Text(content));
                                        }
                                    }
                                }
                                Err(e) => {
                                    // Check if this is an API error response (e.g. context length exceeded)
                                    if let Ok(err_resp) = serde_json::from_str::<serde_json::Value>(data) {
                                        if let Some(err_msg) = err_resp.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                                            tracing::error!("[ChatStream] API error: {}", err_msg);
                                            yield Err(LlmError::ApiError(err_msg.to_string()));
                                            return;
                                        }
                                    }
                                    tracing::warn!("[ChatStream] Failed to parse SSE data ({} chars): {} | raw: {}",
                                        data.len(), e, &data[..data.len().min(500)]);
                                }
                            }
                        }
                        current_line.clear();
                    } else if byte != b'\r' {
                        current_line.push(byte);
                    }
                }
            }

            let line = String::from_utf8_lossy(&current_line).trim().to_string();
            if !line.is_empty() && line.starts_with("data: ") {
                let data = &line[6..];
                if data != "[DONE]" {
                    if let Ok(resp) = serde_json::from_str::<ChatResponseStream>(data) {
                        for choice in resp.choices {
                            let content = choice.delta.content();
                            if !content.is_empty() {
                                yield Ok(SummaryStreamItem::Text(content));
                            }
                        }
                    }
                }
            }
            tracing::debug!("[ChatStream] Stream completed");
        })
    }

    /// Generate a source-grounded summary with true streaming token output
    ///
    /// Returns a stream of SummaryStreamItem (text tokens and done signals)
    /// Note: Takes `self` by ownership to avoid lifetime issues with async_stream
    pub fn into_summary_stream(
        self,
        request: &SourceGroundedSummaryRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<SummaryStreamItem, LlmError>> + Send + 'static>> {
        // Build NotebookLM-style prompt
        let prompt = build_summary_prompt(request);
        let model = self.model.clone();
        let base_url = self.base_url.clone();

        Box::pin(async_stream::stream! {
            let chat_request = ChatRequest {
                model: model.clone(),
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
                temperature: 0.3,
                stream: Some(true),
            };

            let url = format!("{}/chat/completions", base_url);
            tracing::debug!("[SourceGroundedSummaryStream] Sending streaming request to {}", url);

            // Retry transient errors on the initial request
            let client = self.client.clone();
            let api_key = self.api_key.clone();
            let response = match with_retry(
                || {
                    let client = client.clone();
                    let url = url.clone();
                    let api_key = api_key.clone();
                    let chat_request = chat_request.clone();
                    async move {
                        let resp = client
                            .post(&url)
                            .header("Authorization", format!("Bearer {}", api_key))
                            .json(&chat_request)
                            .send()
                            .await
                            .map_err(|e| {
                                tracing::error!("[SourceGroundedSummaryStream] Connection error: {}", e);
                                LlmError::ConnectionError(e.to_string())
                            })?;

                        if !resp.status().is_success() {
                            let status = resp.status();
                            let body = resp.text().await.unwrap_or_default();
                            tracing::error!("[SourceGroundedSummaryStream] API error {}: {}", status, body);
                            return Err(LlmError::ApiError(format!(
                                "API error {}: {}",
                                status, body
                            )));
                        }
                        Ok(resp)
                    }
                },
                3,
            )
            .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    yield Err(e);
                    return;
                }
            };

            // Stream tokens as they arrive
            let mut stream = response.bytes_stream();
            let mut current_line: Vec<u8> = Vec::new();

            while let Some(item) = stream.next().await {
                let chunk = match item {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        tracing::error!("[SourceGroundedSummaryStream] Read error: {}", e);
                        yield Err(LlmError::ConnectionError(e.to_string()));
                        return;
                    }
                };

                for byte in chunk {
                    if byte == b'\n' {
                        let line = String::from_utf8_lossy(&current_line).trim().to_string();
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" {
                                tracing::debug!("[SourceGroundedSummaryStream] Received [DONE], ending stream");
                                yield Ok(SummaryStreamItem::Done);
                                return;
                            }
                            match serde_json::from_str::<ChatResponseStream>(data) {
                                Ok(resp) => {
                                    for choice in resp.choices {
                                        // Check for finish_reason to detect stream end
                                        if choice.finish_reason.as_deref() == Some("stop") {
                                            tracing::debug!("[SourceGroundedSummaryStream] Received stop signal");
                                            yield Ok(SummaryStreamItem::Done);
                                            return;
                                        }
                                        let content = choice.delta.content();
                                        if !content.is_empty() {
                                            yield Ok(SummaryStreamItem::Text(content));
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("[SourceGroundedSummaryStream] Failed to parse SSE data: {}", e);
                                }
                            }
                        }
                        current_line.clear();
                    } else if byte != b'\r' {
                        current_line.push(byte);
                    }
                }
            }

            // Handle any remaining data in buffer (SSE lines without trailing newline)
            let line = String::from_utf8_lossy(&current_line).trim().to_string();
            if !line.is_empty() && line.starts_with("data: ") {
                let data = &line[6..];
                if data != "[DONE]" {
                    if let Ok(resp) = serde_json::from_str::<ChatResponseStream>(data) {
                        for choice in resp.choices {
                            let content = choice.delta.content();
                            if !content.is_empty() {
                                yield Ok(SummaryStreamItem::Text(content));
                            }
                        }
                    }
                }
            }
            tracing::debug!("[SourceGroundedSummaryStream] Stream completed");
        })
    }
}

/// Build system prompt for concept extraction
fn build_system_prompt(language: &str) -> String {
    match language {
        "en" => r#"You are a concept extraction assistant. Your task is to analyze text and extract structured concept information.

Requirements:
- Output language must be English
- Always include source_chunk_id in your response
- Extract concepts (important terms, entities, ideas) and their relationships
- Each concept MUST have:
  * name: concise concept name (2-5 words), translated if needed for clarity
  * native_term: the exact term as it appears in the ORIGINAL text (DO NOT translate, keep it exactly as written in the source)
  * description: detailed explanation in 2-3 sentences
  * examples: array of 1-2 concrete examples from the text
  * category: classification (e.g., "Theory", "Method", "Person", "Organization")
  * page_number: approximate page number where this concept appears (integer, optional)
- Each relation should have: source_name, target_name, relation_type, explanation
- Output ONLY valid JSON matching the JSON Schema format provided
- Be thorough but only extract significant concepts"#.to_string(),
        _ => r#"你是一个概念提取助手。你的任务是分析文本并提取结构化的概念信息。

要求：
- 输出语言必须是中文
- 始终在响应中包含 source_chunk_id
- 提取概念（重要的术语、实体、想法）及其关系
- 每个概念必须包含：
  * name: 简洁的概念名称（2-5个词）
  * native_term: 原文中的精确术语（不要翻译，保持原文原样）
  * description: 详细描述，2-3句话的解释
  * examples: 1-2个具体示例的数组，必须来自原文
  * category: 分类（如"理论"、"方法"、"人物"、"组织"）
  * page_number: 概念出现的近似页码（整数，可选）
- 每个关系应包含：源概念名、目标概念名、关系类型、解释
- 只输出符合JSON Schema格式的有效JSON
- 要全面但只提取重要的概念"#.to_string(),
    }
}

/// Build user prompt for concept extraction
fn build_user_prompt(chunk_content: &str, chunk_id: &str, language: &str) -> String {
    match language {
        "en" => format!(
            r#"Extract concepts and relations from the following text (chunk_id: {}).

---

{}

---

JSON Schema for output validation:
{{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["source_chunk_id", "concepts", "relations"],
  "properties": {{
    "source_chunk_id": {{ "type": "string" }},
    "concepts": {{
      "type": "array",
      "items": {{
        "type": "object",
        "required": ["name", "native_term", "description", "examples", "category", "page_number"],
        "properties": {{
          "name": {{ "type": "string", "minLength": 1, "maxLength": 100 }},
          "native_term": {{ "type": ["string", "null"] }},
          "description": {{ "type": "string", "minLength": 10, "maxLength": 500 }},
          "examples": {{ "type": "array", "minItems": 1, "maxItems": 2, "items": {{ "type": "string" }} }},
          "category": {{ "type": "string" }},
          "page_number": {{ "type": ["integer", "null"] }}
        }}
      }}
    }},
    "relations": {{
      "type": "array",
      "items": {{
        "type": "object",
        "required": ["source_name", "target_name", "relation_type", "explanation"],
        "properties": {{
          "source_name": {{ "type": "string" }},
          "target_name": {{ "type": "string" }},
          "relation_type": {{ "type": "string" }},
          "explanation": {{ "type": "string" }}
        }}
      }}
    }}
  }}
}}

Output JSON format:
{{
  "source_chunk_id": "{}",
  "concepts": [
    {{
      "name": "concept name",
      "native_term": "exact term from original text",
      "description": "Detailed description in 2-3 sentences explaining what this concept means",
      "examples": ["example1 from text", "example2 from text"],
      "category": "category name",
      "page_number": 1
    }}
  ],
  "relations": [
    {{
      "source_name": "source concept",
      "target_name": "target concept",
      "relation_type": "relation type",
      "explanation": "how they relate"
    }}
  ]
}}

Important:
- Description must be 2-3 sentences providing substantial explanation
- Examples must be 1-2 items from the actual text
- page_number is optional but should be extracted if available in the text"#,
            chunk_id, chunk_content, chunk_id
        ),
        _ => format!(
            r#"从以下文本中提取概念和关系（chunk_id: {}）。

---

{}

---

JSON Schema 用于输出验证：
{{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["source_chunk_id", "concepts", "relations"],
  "properties": {{
    "source_chunk_id": {{ "type": "string" }},
    "concepts": {{
      "type": "array",
      "items": {{
        "type": "object",
        "required": ["name", "native_term", "description", "examples", "category", "page_number"],
        "properties": {{
          "name": {{ "type": "string", "minLength": 1, "maxLength": 100 }},
          "native_term": {{ "type": ["string", "null"] }},
          "description": {{ "type": "string", "minLength": 10, "maxLength": 500 }},
          "examples": {{ "type": "array", "minItems": 1, "maxItems": 2, "items": {{ "type": "string" }} }},
          "category": {{ "type": "string" }},
          "page_number": {{ "type": ["integer", "null"] }}
        }}
      }}
    }},
    "relations": {{
      "type": "array",
      "items": {{
        "type": "object",
        "required": ["source_name", "target_name", "relation_type", "explanation"],
        "properties": {{
          "source_name": {{ "type": "string" }},
          "target_name": {{ "type": "string" }},
          "relation_type": {{ "type": "string" }},
          "explanation": {{ "type": "string" }}
        }}
      }}
    }}
  }}
}}

输出JSON格式：
{{
  "source_chunk_id": "{}",
  "concepts": [
    {{
      "name": "概念名称",
      "native_term": "原文中的精确术语",
      "description": "详细描述，用2-3句话解释这个概念的含义",
      "examples": ["来自文本的示例1", "来自文本的示例2"],
      "category": "类别名称",
      "page_number": 1
    }}
  ],
  "relations": [
    {{
      "source_name": "源概念名",
      "target_name": "目标概念名",
      "relation_type": "关系类型",
      "explanation": "关系说明"
    }}
  ]
}}

重要提示：
- 描述必须是2-3句话，提供充分的解释
- 示例必须是1-2个来自原文的具体例子
- page_number是可选的，但如果文本中有页码信息应该提取"#,
            chunk_id, chunk_content, chunk_id
        ),
    }
}

/// Parse the LLM response into structured data with enhanced error handling
fn parse_extraction_response(
    content: &str,
    language: &str,
) -> Result<ConceptExtractionResponse, LlmError> {
    // Try to extract JSON from the content (in case there's any wrapper text)
    let json_str = crate::utils::extract_json(content)
        .ok_or_else(|| LlmError::ParseError("No JSON found in response".to_string()))?;

    tracing::debug!("Parsing JSON response of length: {}", json_str.len());

    // Attempt to parse the response
    let parsed: ParsedResponse = match serde_json::from_str(json_str) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("Failed to parse JSON response: {}", e);
            tracing::debug!("Raw content that failed parsing: {}", content);
            return Err(LlmError::ParseError(format!(
                "Invalid JSON structure: {}. Response must match the provided JSON Schema.",
                e
            )));
        }
    };

    // Validate concepts
    let mut valid_concepts: Vec<ExtractedConcept> = Vec::new();
    let mut invalid_concept_count = 0;

    for (idx, concept) in parsed.concepts.into_iter().enumerate() {
        // Validate required fields
        if concept.name.trim().is_empty() {
            tracing::warn!("Concept at index {} has empty name, skipping", idx);
            invalid_concept_count += 1;
            continue;
        }

        if concept.description.trim().is_empty() {
            tracing::warn!("Concept '{}' has empty description, using fallback", concept.name);
        }

        // Validate examples - ensure we have at least 1
        let examples: Vec<String> = concept
            .examples
            .into_iter()
            .filter(|ex| !ex.trim().is_empty())
            .collect();

        if examples.is_empty() {
            tracing::debug!("Concept '{}' has no valid examples", concept.name);
        }

        // Validate page_number (should be positive if present)
        let page_number = concept.page_number.filter(|&p| p > 0);

        valid_concepts.push(ExtractedConcept {
            name: concept.name.trim().to_string(),
            native_term: concept.native_term.as_ref().map(|s| s.trim().to_string()),
            description: concept.description.trim().to_string(),
            examples,
            category: concept.category.filter(|c| !c.trim().is_empty()),
            page_number,
        });
    }

    if invalid_concept_count > 0 {
        tracing::warn!(
            "Skipped {} concepts due to validation errors",
            invalid_concept_count
        );
    }

    // Validate relations
    let mut valid_relations: Vec<ExtractedRelation> = Vec::new();
    let mut invalid_relation_count = 0;

    for (idx, relation) in parsed.relations.into_iter().enumerate() {
        if relation.source_name.trim().is_empty() || relation.target_name.trim().is_empty() {
            tracing::warn!("Relation at index {} has empty source or target name, skipping", idx);
            invalid_relation_count += 1;
            continue;
        }

        if relation.relation_type.trim().is_empty() {
            tracing::warn!(
                "Relation from '{}' to '{}' has empty relation_type, using default",
                relation.source_name,
                relation.target_name
            );
        }

        valid_relations.push(ExtractedRelation {
            source_name: relation.source_name.trim().to_string(),
            target_name: relation.target_name.trim().to_string(),
            relation_type: relation.relation_type.trim().to_string(),
            explanation: relation.explanation.trim().to_string(),
        });
    }

    if invalid_relation_count > 0 {
        tracing::warn!(
            "Skipped {} relations due to validation errors",
            invalid_relation_count
        );
    }

    tracing::info!(
        "Parsed {} valid concepts and {} valid relations",
        valid_concepts.len(),
        valid_relations.len()
    );

    Ok(ConceptExtractionResponse {
        concepts: valid_concepts,
        relations: valid_relations,
        language: language.to_string(),
    })
}

/// Maximum number of sources to include in the summary prompt
const MAX_SUMMARY_SOURCES: usize = 5;
/// Maximum characters per source content (to stay within context limits)
const MAX_SOURCE_CHARS: usize = 1500;

/// Build NotebookLM-style prompt for source-grounded summary
fn build_summary_prompt(request: &SourceGroundedSummaryRequest) -> String {
    let node_context = if let Some(desc) = &request.node_description {
        format!("{}: {}", request.node_name, desc)
    } else {
        request.node_name.clone()
    };

    let mut prompt = format!(
        r#"You are an expert research assistant. Based on the retrieved source materials below, provide a comprehensive summary about the following topic:

TOPIC: {}

---

RETRIEVED SOURCE MATERIALS:

"#,
        node_context
    );

    // Limit the number of sources to stay within context length
    let limited_results: Vec<_> = request.retrieval_results.iter()
        .take(MAX_SUMMARY_SOURCES)
        .collect();

    // Add each retrieval result as a source, with content truncation
    for (idx, result) in limited_results.iter().enumerate() {
        let page_info = if result.page_start == result.page_end {
            format!("Page {}", result.page_start)
        } else {
            format!("Pages {}-{}", result.page_start, result.page_end)
        };

        // Truncate content to stay within context limits (char-safe for multi-byte UTF-8)
        let truncated_content = if result.content.chars().count() > MAX_SOURCE_CHARS {
            format!("{}...[content truncated]", result.content.chars().take(MAX_SOURCE_CHARS).collect::<String>())
        } else {
            result.content.clone()
        };

        prompt.push_str(&format!(
            "[Source {}] ({}):\n{}\n\n",
            idx + 1,
            page_info,
            truncated_content
        ));
    }

    prompt.push_str(
        r#"---

INSTRUCTIONS:
1. Synthesize the information from the sources into a coherent summary about the topic.
2. When you use information from a specific source, cite it using [Source: X] format where X is the source number.
3. Include at least one citation per major point or claim.
4. Be concise but comprehensive - aim for 3-5 paragraphs.
5. Focus on the most relevant and important information from the sources.

OUTPUT FORMAT:
- Output the summary text directly. Do NOT output JSON.
- Include inline citations using [Source: X] format where X is the source number.
- Do NOT wrap the output in markdown code blocks or any other formatting.
- Output ONLY the summary text, nothing else.

Example output:
Key-Value Cache is a foundational technique for efficient LLM inference [Source: 1]. It stores key-value pairs derived from previous tokens, allowing the model to avoid redundant calculations when generating new tokens [Source: 2]. However, this approach introduces a significant memory cost [Source: 3].

Important:
- Output ONLY plain text, no JSON, no markdown code blocks
- Every major claim must have a citation
- Summary should be 200-500 words
"#,
    );

    prompt
}

/// Summary response from LLM
/// Reserved for future JSON-mode summary parsing.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SummaryResponse {
    summary: String,
    citations: Vec<ParsedCitation>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ParsedCitation {
    index: usize,
    pages: Option<String>,
}

/// Parse the LLM response into a SourceGroundedSummary
/// Reserved for future JSON-mode summary parsing.
#[allow(dead_code)]
fn parse_summary_response(
    content: &str,
    request: &SourceGroundedSummaryRequest,
) -> Result<SourceGroundedSummary, LlmError> {
    // Try to extract JSON from the content
    let json_str = crate::utils::extract_json(content)
        .ok_or_else(|| LlmError::ParseError("No JSON found in response".to_string()))?;

    tracing::debug!("[parse_summary_response] Parsing JSON of length: {}", json_str.len());

    // Attempt to parse the response
    let parsed: SummaryResponse = match serde_json::from_str(json_str) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("[parse_summary_response] Failed to parse JSON: {}", e);
            tracing::debug!("[parse_summary_response] Raw content: {}", content);
            return Err(LlmError::ParseError(format!(
                "Invalid JSON structure: {}",
                e
            )));
        }
    };

    // Build citations from the parsed data and original request
    let mut citations: Vec<Citation> = Vec::new();

    for parsed_citation in parsed.citations.iter() {
        let idx = parsed_citation.index;
        if idx == 0 || idx > request.retrieval_results.len() {
            tracing::warn!(
                "Citation index {} is out of range (1-{}), skipping",
                idx,
                request.retrieval_results.len()
            );
            continue;
        }

        // Get the corresponding retrieval result
        let result = &request.retrieval_results[idx - 1];

        // Create excerpt from content (first 200 chars)
        let excerpt = result.content.chars().take(200).collect::<String>();

        citations.push(Citation {
            index: idx,
            chunk_id: result.chunk_id.clone(),
            page_start: result.page_start,
            page_end: result.page_end,
            excerpt,
        });
    }

    // Also extract citations from the summary text by finding [Source: X] patterns
    // and ensuring they're in our citations list
    for caps in crate::utils::CITATION_REGEX.captures_iter(&parsed.summary) {
        let idx: usize = caps[1].parse().unwrap_or(0);
        if idx > 0 && idx <= request.retrieval_results.len() {
            // Check if this citation is already in the list
            if !citations.iter().any(|c| c.index == idx) {
                let result = &request.retrieval_results[idx - 1];
                let excerpt = result.content.chars().take(200).collect::<String>();
                citations.push(Citation {
                    index: idx,
                    chunk_id: result.chunk_id.clone(),
                    page_start: result.page_start,
                    page_end: result.page_end,
                    excerpt,
                });
            }
        }
    }

    // Sort citations by index
    citations.sort_by_key(|c| c.index);

    tracing::info!(
        "[parse_summary_response] Generated summary with {} citations",
        citations.len()
    );

    Ok(SourceGroundedSummary {
        summary: parsed.summary,
        citations,
    })
}

/// Internal parsed response structure
#[derive(Debug, Deserialize)]
struct ParsedResponse {
    #[serde(alias = "source_chunk_id")]
    #[allow(dead_code)]
    source_chunk_id: Option<String>,
    concepts: Vec<ParsedConcept>,
    relations: Vec<ParsedRelation>,
}

#[derive(Debug, Deserialize)]
struct ParsedConcept {
    name: String,
    #[serde(default)]
    native_term: Option<String>,
    description: String,
    examples: Vec<String>,
    category: Option<String>,
    page_number: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ParsedRelation {
    source_name: String,
    target_name: String,
    relation_type: String,
    explanation: String,
}

/// Errors that can occur during LLM operations
#[derive(Debug)]
pub enum LlmError {
    ConnectionError(String),
    ApiError(String),
    ParseError(String),
    EmptyResponse,
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::ConnectionError(msg) => write!(f, "Connection error: {}", msg),
            LlmError::ApiError(msg) => write!(f, "API error: {}", msg),
            LlmError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            LlmError::EmptyResponse => write!(f, "Empty response from LLM"),
        }
    }
}

impl std::error::Error for LlmError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_system_prompt_zh() {
        let prompt = build_system_prompt("zh");
        assert!(prompt.contains("中文"));
    }

    #[test]
    fn test_build_system_prompt_en() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains("English"));
    }

    #[test]
    fn test_extract_json_with_wrapper() {
        let content = "Here is the JSON: {\"concepts\": [], \"relations\": []}";
        let json = crate::utils::extract_json(content).unwrap();
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }

    #[test]
    fn test_parse_empty_response() {
        let content = r#"{"source_chunk_id": "test", "concepts": [], "relations": []}"#;
        let result = parse_extraction_response(content, "zh");
        assert!(result.is_ok());
    }
}