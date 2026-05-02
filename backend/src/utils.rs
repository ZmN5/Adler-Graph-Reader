use regex::Regex;
use std::sync::LazyLock;

/// Shared regex pattern for extracting citation indices like [Source: 1]
pub static CITATION_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[Source:\s*(\d+)\]").expect("invalid citation regex"));

/// Extract JSON object or array from a string that might have wrapper text.
/// Tries object first, then array.
pub fn extract_json(content: &str) -> Option<&str> {
    // Try JSON object
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            if end > start {
                return Some(&content[start..=end]);
            }
        }
    }

    // Try JSON array
    if let Some(start) = content.find('[') {
        if let Some(end) = content.rfind(']') {
            if end > start {
                return Some(&content[start..=end]);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_object() {
        let content = r#"Some text before {"key": "value"} and after"#;
        let json = extract_json(content).unwrap();
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }

    #[test]
    fn test_extract_json_with_wrapper() {
        let content = "Here is the JSON: {\"concepts\": [], \"relations\": []}";
        let json = extract_json(content).unwrap();
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }

    #[test]
    fn test_extract_json_array() {
        let content = r#"Some text before [1, 2, 3] and after"#;
        let json = extract_json(content).unwrap();
        assert!(json.starts_with('['));
        assert!(json.ends_with(']'));
    }
}
