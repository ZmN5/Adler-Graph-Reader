/// Split text into chunks of approximately target_size with overlap
///
/// # Arguments
/// * `text` - The text to split
/// * `target_size` - Target chunk size in characters
/// * `overlap` - Number of characters to overlap between chunks
///
/// # Returns
/// * `Vec<String>` - The text chunks
pub fn split_text_with_overlap(text: &str, target_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let total_chars = chars.len();

    if total_chars <= target_size {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0;

    while start < total_chars {
        let end = (start + target_size).min(total_chars);
        let chunk_text: String = chars[start..end].iter().collect();

        chunks.push(chunk_text);

        // Move start forward (target_size - overlap to maintain overlap)
        if end >= total_chars {
            break;
        }
        start = end - overlap;
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_text_short() {
        let text = "short";
        let result = split_text_with_overlap(text, 100, 10);
        assert_eq!(result, vec!["short"]);
    }

    #[test]
    fn test_split_text_exact_size() {
        let text = "exactly ten";
        let result = split_text_with_overlap(text, 10, 2);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "exactly te");
        assert_eq!(result[1], "ten");
    }

    #[test]
    fn test_split_text_with_overlap() {
        let text = "abcdefghijklmnopqrstuvwxyz";
        let result = split_text_with_overlap(text, 10, 2);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], "abcdefghij");
        assert_eq!(result[1], "ijklmnopqr");
        assert_eq!(result[2], "qrstuvwxyz");
    }

    #[test]
    fn test_split_text_unicode() {
        let text = "你好世界这是一段中文测试文本";
        let result = split_text_with_overlap(text, 5, 1);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], "你好世界这");
        assert_eq!(result[1], "这是一段中");
        assert_eq!(result[2], "中文测试文");
        assert_eq!(result[3], "文本");
    }
}
