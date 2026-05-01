use std::io::{Read, BufReader};
use zip::ZipArchive;

/// Get the path to content.opf from container.xml
pub fn get_content_opf_path(archive: &mut ZipArchive<BufReader<std::fs::File>>) -> Result<String, String> {
    let mut container_file = archive.by_name("META-INF/container.xml")
        .map_err(|e| format!("Failed to find container.xml: {}", e))?;

    let mut container_xml = String::new();
    container_file.read_to_string(&mut container_xml)
        .map_err(|e| format!("Failed to read container.xml: {}", e))?;

    let start = container_xml.find("full-path=\"").ok_or("Could not find full-path in container.xml")?;
    let start = start + "full-path=\"".len();
    let end = container_xml[start..].find('"').ok_or("Could not find end of full-path")?;
    let opf_path = container_xml[start..start + end].to_string();

    Ok(opf_path)
}

/// Parse content.opf to get manifest (id -> href) and spine (ordered idref list)
pub fn parse_content_opf(
    archive: &mut ZipArchive<BufReader<std::fs::File>>,
    opf_path: &str,
) -> Result<(std::collections::HashMap<String, String>, Vec<String>), String> {
    let mut opf_file = archive.by_name(opf_path)
        .map_err(|e| format!("Failed to find content.opf at {}: {}", opf_path, e))?;

    let mut opf_xml = String::new();
    opf_file.read_to_string(&mut opf_xml)
        .map_err(|e| format!("Failed to read content.opf: {}", e))?;

    // Parse manifest: build id -> href map
    let mut manifest: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let manifest_start = opf_xml.find("<manifest>").ok_or("Could not find <manifest>")?;
    let manifest_end = opf_xml.find("</manifest>").ok_or("Could not find </manifest>")?;
    let manifest_section = &opf_xml[manifest_start..manifest_end];

    let mut pos = 0;
    while let Some(item_start) = manifest_section[pos..].find("<item") {
        let item_start = pos + item_start;
        let item_end = manifest_section[item_start..].find("/>")
            .map(|p| item_start + p + 2)
            .or_else(|| manifest_section[item_start..].find("</item>")
                .map(|p| item_start + p + 7))
            .ok_or("Could not parse manifest item")?;

        let item_xml = &manifest_section[item_start..item_end];

        let href = if let Some(href_start) = item_xml.find("href=\"") {
            let href_start = href_start + 6;
            let href_end = item_xml[href_start..].find('"').ok_or("Could not find href value")?;
            item_xml[href_start..href_start + href_end].to_string()
        } else {
            pos = item_end;
            continue;
        };

        let id = if let Some(id_start) = item_xml.find("id=\"") {
            let id_start = id_start + 4;
            let id_end = item_xml[id_start..].find('"').ok_or("Could not find id value")?;
            item_xml[id_start..id_start + id_end].to_string()
        } else {
            pos = item_end;
            continue;
        };

        manifest.insert(id, href);
        pos = item_end;
    }

    // Parse spine: extract ordered list of idref values
    let mut spine: Vec<String> = Vec::new();

    let spine_start = opf_xml.find("<spine").ok_or("Could not find <spine>")?;
    let spine_end = opf_xml[spine_start..].find(">")
        .map(|p| spine_start + p + 1)
        .unwrap_or(spine_start + "<spine".len());

    let after_spine_tag = if &opf_xml[spine_end - 1..spine_end] == "/" {
        spine_end
    } else if let Some(closing) = opf_xml[spine_start..].find("</spine>") {
        spine_start + closing
    } else {
        return Err("Could not find end of spine".to_string());
    };

    let spine_section = &opf_xml[spine_end..after_spine_tag];

    let mut pos = 0;
    while let Some(itemref_start) = spine_section[pos..].find("<itemref") {
        let itemref_start = pos + itemref_start;
        let itemref_end = spine_section[itemref_start..].find("/>")
            .map(|p| itemref_start + p + 2)
            .or_else(|| spine_section[itemref_start..].find(">")
                .map(|p| itemref_start + p + 1))
            .ok_or("Could not parse itemref")?;

        let itemref_xml = &spine_section[itemref_start..itemref_end];

        if let Some(idref_start) = itemref_xml.find("idref=\"") {
            let idref_start = idref_start + 7;
            let idref_end = itemref_xml[idref_start..].find('"').ok_or("Could not find idref value")?;
            let idref = itemref_xml[idref_start..idref_start + idref_end].to_string();
            spine.push(idref);
        }

        pos = itemref_end;
    }

    Ok((manifest, spine))
}

/// Check if a spine item href points to a non-content file (nav, toc, cover, etc.)
/// Uses exact filename matching to avoid false positives (e.g. "discover.xhtml" should NOT match "cover.")
pub fn is_non_content_spine_item(href: &str) -> bool {
    let file_name = href.rsplit('/').next().unwrap_or(href).to_lowercase();
    const NON_CONTENT_FILES: &[&str] = &[
        "nav.xhtml",
        "nav.html",
        "toc.xhtml",
        "toc.html",
        "toc.ncx",
        "cover.xhtml",
        "cover.html",
        "cover.htm",
        "coverpage.xhtml",
        "coverpage.html",
        "titlepage.xhtml",
        "titlepage.html",
        "copyright.xhtml",
        "copyright.html",
        "dedication.xhtml",
        "dedication.html",
        "acknowledgments.xhtml",
        "acknowledgments.html",
    ];
    NON_CONTENT_FILES.contains(&file_name.as_str())
}

/// Count the number of content chapters in an EPUB file
/// Returns the count of spine items that are actual content (excluding nav, toc, cover)
pub fn count_epub_chapters(file_path: &str) -> Result<i32, String> {
    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(format!("EPUB file not found: {}", file_path));
    }

    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open EPUB file: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Failed to read EPUB as ZIP: {}", e))?;

    let content_opf_path = get_content_opf_path(&mut archive)?;
    let (manifest, spine) = parse_content_opf(&mut archive, &content_opf_path)?;

    let mut chapter_count = 0;
    for itemref in &spine {
        if let Some(href) = manifest.get(itemref.as_str()) {
            if is_non_content_spine_item(href) {
                continue;
            }
            chapter_count += 1;
        }
    }

    Ok(chapter_count)
}
