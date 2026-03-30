use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// LLM Client for connecting to LM Studio (OpenAI-compatible API)
pub struct LlmClient {
    client: Client,
    base_url: String,
}

/// OpenAI-compatible chat message
#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// OpenAI-compatible request structure
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
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

/// Concept extracted from a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedConcept {
    pub name: String,
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

impl LlmClient {
    /// Create a new LLM client connecting to the specified URL
    pub fn new(base_url: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
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

        // Use model from environment or default to qwen3.5-9b
        let model = std::env::var("LLM_MODEL").unwrap_or_else(|_| "qwen3.5-9b".to_string());
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
        };

        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!("[LM Client] Sending request to {}", url);
        tracing::trace!("[LM Client] Request: {:?}", request);

        let response = self
            .client
            .post(&url)
            .header("Authorization", "Bearer lm-studio")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("[LM Client] Connection error: {}", e);
                LlmError::ConnectionError(e.to_string())
            })?;

        tracing::debug!("[LM Client] Response status: {}", response.status());

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!("[LM Client] API error {}: {}", status, body);
            return Err(LlmError::ApiError(format!(
                "API error {}: {}",
                status, body
            )));
        }

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
  * name: concise concept name (2-5 words)
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
        "required": ["name", "description", "examples", "category", "page_number"],
        "properties": {{
          "name": {{ "type": "string", "minLength": 1, "maxLength": 100 }},
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
        "required": ["name", "description", "examples", "category", "page_number"],
        "properties": {{
          "name": {{ "type": "string", "minLength": 1, "maxLength": 100 }},
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
    let json_str = extract_json(content)?;

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

/// Extract JSON from a string that might have wrapper text
fn extract_json(content: &str) -> Result<&str, LlmError> {
    // Try to find JSON object
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            if end > start {
                return Ok(&content[start..=end]);
            }
        }
    }

    // Try JSON array
    if let Some(start) = content.find('[') {
        if let Some(end) = content.rfind(']') {
            if end > start {
                return Ok(&content[start..=end]);
            }
        }
    }

    Err(LlmError::ParseError("No JSON found in response".to_string()))
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
        let json = extract_json(content).unwrap();
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