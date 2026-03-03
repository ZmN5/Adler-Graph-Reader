"""
GraphML and GEXF export for knowledge graphs.

GraphML is an XML-based file format for graphs, supported by:
- Gephi (https://gephi.org)
- Cytoscape (https://cytoscape.org)
- yEd (https://www.yworks.com/yed)
- NetworkX

GEXF is the Graph Exchange XML Format, native to Gephi.
"""

import xml.etree.ElementTree as ET
from pathlib import Path


class GraphMLExporter:
    """Export knowledge graph to GraphML format."""

    # GraphML namespace
    NS = "http://graphml.graphdrawing.org/xmlns"
    XSI = "http://www.w3.org/2001/XMLSchema-instance"

    # Relation types supported
    RELATION_TYPES = {
        "related_to": {"color": "#95A5A6", "style": "dashed"},
        "broader_than": {"color": "#FF6B6B", "style": "bold"},
        "narrower_than": {"color": "#4ECDC4", "style": "bold"},
        "prerequisite_for": {"color": "#9B59B6", "style": "bold"},
        "supports": {"color": "#27AE60", "style": "solid"},
        "causes": {"color": "#E74C3C", "style": "bold"},
        "part_of": {"color": "#3498DB", "style": "solid"},
        "implements": {"color": "#F39C12", "style": "solid"},
        "uses": {"color": "#1ABC9C", "style": "dashed"},
        "produces": {"color": "#E67E22", "style": "solid"},
        "evaluates": {"color": "#8E44AD", "style": "dashed"},
        "improves": {"color": "#16A085", "style": "solid"},
        "similar_to": {"color": "#3498DB", "style": "dotted"},
        "contradicts": {"color": "#C0392B", "style": "bold"},
        "has_concept": {"color": "#BDC3C7", "style": "dashed"},
    }

    # Node categories with colors (for Gephi visualization)
    CATEGORY_COLORS = {
        "theme": {"r": 255, "g": 230, "b": 230},  # Light red
        "concept": {"r": 230, "g": 243, "b": 255},  # Light blue
        "principle": {"r": 230, "g": 255, "b": 230},  # Light green
        "method": {"r": 255, "g": 245, "b": 230},  # Light orange
        "tool": {"r": 240, "g": 230, "b": 255},  # Light purple
        "person": {"r": 255, "g": 230, "b": 240},  # Light pink
        "event": {"r": 230, "g": 255, "b": 255},  # Light cyan
    }

    def __init__(self, title: str = "Knowledge Graph"):
        self.title = title

    def export(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
        output_path: Path,
    ) -> Path:
        """
        Export graph to GraphML format.

        Args:
            themes: List of theme dicts with id, name, description, importance_score
            concepts: List of concept dicts with id, name, definition, category, importance_score
            relations: List of relation dicts with source_concept_id, target_concept_id, relation_type, strength
            output_path: Output file path (.graphml)

        Returns:
            Path to the output file
        """
        # Create root element with namespaces
        root = ET.Element("graphml")
        root.set("xmlns", self.NS)
        root.set("xmlns:xsi", self.XSI)
        root.set(
            "xsi:schemaLocation",
            f"{self.NS} http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd",
        )

        # Define node attributes (keys)
        self._add_key(root, "d0", "node", "label", "string")
        self._add_key(root, "d1", "node", "type", "string")  # theme/concept
        self._add_key(root, "d2", "node", "category", "string")  # concept category
        self._add_key(root, "d3", "node", "description", "string")
        self._add_key(root, "d4", "node", "importance", "float")
        self._add_key(root, "d5", "node", "r", "int")  # color red
        self._add_key(root, "d6", "node", "g", "int")  # color green
        self._add_key(root, "d7", "node", "b", "int")  # color blue

        # Define edge attributes (keys)
        self._add_key(root, "d8", "edge", "label", "string")
        self._add_key(root, "d9", "edge", "relation_type", "string")
        self._add_key(root, "d10", "edge", "strength", "float")
        self._add_key(root, "d11", "edge", "evidence", "string")
        self._add_key(root, "d12", "edge", "color", "string")

        # Create graph element
        graph = ET.SubElement(root, "graph")
        graph.set("id", self._sanitize_id(self.title))
        graph.set("edgedefault", "directed")

        # Add theme nodes
        for theme in themes:
            node = ET.SubElement(graph, "node")
            node_id = f"theme_{theme['id']}"
            node.set("id", node_id)

            # Label (name)
            self._add_data(node, "d0", theme.get("name", ""))
            # Type
            self._add_data(node, "d1", "theme")
            # Category (empty for themes)
            self._add_data(node, "d2", "")
            # Description
            desc = theme.get("description", "")
            self._add_data(node, "d3", desc[:500] if desc else "")
            # Importance score
            importance = theme.get("importance_score", 0.5)
            self._add_data(node, "d4", str(importance))
            # Color (light red for themes)
            color = self.CATEGORY_COLORS["theme"]
            self._add_data(node, "d5", str(color["r"]))
            self._add_data(node, "d6", str(color["g"]))
            self._add_data(node, "d7", str(color["b"]))

        # Add concept nodes
        for concept in concepts:
            node = ET.SubElement(graph, "node")
            node_id = f"concept_{concept['id']}"
            node.set("id", node_id)

            # Label (name)
            self._add_data(node, "d0", concept.get("name", ""))
            # Type
            self._add_data(node, "d1", "concept")
            # Category
            category = concept.get("category", "concept")
            self._add_data(node, "d2", category)
            # Definition as description
            definition = concept.get("definition", "")
            self._add_data(node, "d3", definition[:500] if definition else "")
            # Importance score
            importance = concept.get("importance_score", 0.5)
            self._add_data(node, "d4", str(importance))
            # Color based on category
            color = self.CATEGORY_COLORS.get(category, self.CATEGORY_COLORS["concept"])
            self._add_data(node, "d5", str(color["r"]))
            self._add_data(node, "d6", str(color["g"]))
            self._add_data(node, "d7", str(color["b"]))

        # Add edges for relations
        edge_id = 0
        for rel in relations:
            source_id = f"concept_{rel['source_concept_id']}"
            target_id = f"concept_{rel['target_concept_id']}"
            rel_type = rel.get("relation_type", "related_to")
            strength = rel.get("strength", 0.5)
            evidence = rel.get("evidence", "")

            edge = ET.SubElement(graph, "edge")
            edge.set("id", f"e{edge_id}")
            edge.set("source", source_id)
            edge.set("target", target_id)

            # Label (relation type)
            self._add_data(edge, "d8", rel_type)
            # Relation type
            self._add_data(edge, "d9", rel_type)
            # Strength
            self._add_data(edge, "d10", str(strength))
            # Evidence
            self._add_data(edge, "d11", evidence[:500] if evidence else "")
            # Color
            color = self.RELATION_TYPES.get(
                rel_type, self.RELATION_TYPES["related_to"]
            )["color"]
            self._add_data(edge, "d12", color)

            edge_id += 1

        # Add edges for theme-concept relationships
        for concept in concepts:
            if concept.get("theme_id"):
                source_id = f"theme_{concept['theme_id']}"
                target_id = f"concept_{concept['id']}"

                edge = ET.SubElement(graph, "edge")
                edge.set("id", f"e{edge_id}")
                edge.set("source", source_id)
                edge.set("target", target_id)

                # Label
                self._add_data(edge, "d8", "has_concept")
                # Relation type
                self._add_data(edge, "d9", "has_concept")
                # Strength (always 1.0 for theme-concept)
                self._add_data(edge, "d10", "1.0")
                # Evidence
                self._add_data(edge, "d11", "")
                # Color
                color = self.RELATION_TYPES["has_concept"]["color"]
                self._add_data(edge, "d12", color)

                edge_id += 1

        # Write to file
        tree = ET.ElementTree(root)
        self._indent(root)  # Pretty print
        tree.write(output_path, encoding="utf-8", xml_declaration=True)

        return output_path

    def _add_key(
        self,
        root: ET.Element,
        key_id: str,
        target: str,
        attr_name: str,
        attr_type: str,
    ) -> None:
        """Add a key definition for node or edge attributes."""
        key = ET.SubElement(root, "key")
        key.set("id", key_id)
        key.set("for", target)
        key.set("attr.name", attr_name)
        key.set("attr.type", attr_type)

    def _add_data(self, parent: ET.Element, key: str, value: str) -> None:
        """Add a data element to node or edge."""
        data = ET.SubElement(parent, "data")
        data.set("key", key)
        data.text = self._escape_xml(value)

    def _sanitize_id(self, text: str) -> str:
        """Sanitize text for use as XML ID."""
        # Replace spaces and special characters
        sanitized = "".join(c if c.isalnum() or c in "_-" else "_" for c in text)
        # Ensure it starts with a letter
        if sanitized and not sanitized[0].isalpha():
            sanitized = "g_" + sanitized
        return sanitized[:50]  # Limit length

    def _escape_xml(self, text: str) -> str:
        """Escape special XML characters."""
        if not text:
            return ""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    def _indent(self, elem: ET.Element, level: int = 0) -> None:
        """Add pretty-print indentation to XML."""
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for child in elem:
                self._indent(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i


class GEXFExporter:
    """Export knowledge graph to GEXF format (Gephi native)."""

    # GEXF namespace
    NS = "http://www.gexf.net/1.3"
    VIZ_NS = "http://www.gexf.net/1.3/viz"

    # Relation types with colors
    RELATION_TYPES = GraphMLExporter.RELATION_TYPES

    # Category colors
    CATEGORY_COLORS = GraphMLExporter.CATEGORY_COLORS

    def __init__(
        self, title: str = "Knowledge Graph", creator: str = "Adler-Graph-Reader"
    ):
        self.title = title
        self.creator = creator

    def export(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
        output_path: Path,
    ) -> Path:
        """
        Export graph to GEXF format.

        Args:
            themes: List of theme dicts
            concepts: List of concept dicts
            relations: List of relation dicts
            output_path: Output file path (.gexf)

        Returns:
            Path to the output file
        """
        # Register namespaces
        ET.register_namespace("", self.NS)
        ET.register_namespace("viz", self.VIZ_NS)

        # Create root element
        root = ET.Element(f"{{{self.NS}}}gexf")
        root.set("version", "1.3")

        # Add metadata
        meta = ET.SubElement(root, f"{{{self.NS}}}meta")
        meta.set("lastmodifieddate", "2026-03-03")
        ET.SubElement(meta, f"{{{self.NS}}}creator").text = self.creator
        ET.SubElement(
            meta, f"{{{self.NS}}}description"
        ).text = f"Knowledge graph: {self.title}"

        # Create graph
        graph = ET.SubElement(root, f"{{{self.NS}}}graph")
        graph.set("defaultedgetype", "directed")
        graph.set("mode", "static")

        # Define node attributes
        node_attrs = ET.SubElement(graph, f"{{{self.NS}}}attributes")
        node_attrs.set("class", "node")
        node_attrs.set("mode", "static")

        self._add_attribute(node_attrs, "0", "type", "string")
        self._add_attribute(node_attrs, "1", "category", "string")
        self._add_attribute(node_attrs, "2", "description", "string")
        self._add_attribute(node_attrs, "3", "importance", "float")

        # Define edge attributes
        edge_attrs = ET.SubElement(graph, f"{{{self.NS}}}attributes")
        edge_attrs.set("class", "edge")
        edge_attrs.set("mode", "static")

        self._add_attribute(edge_attrs, "4", "relation_type", "string")
        self._add_attribute(edge_attrs, "5", "strength", "float")
        self._add_attribute(edge_attrs, "6", "evidence", "string")

        # Create nodes
        nodes_elem = ET.SubElement(graph, f"{{{self.NS}}}nodes")

        # Add theme nodes
        for theme in themes:
            node = ET.SubElement(nodes_elem, f"{{{self.NS}}}node")
            node_id = f"theme_{theme['id']}"
            node.set("id", node_id)
            node.set("label", theme.get("name", ""))

            # Add attvalues
            attvalues = ET.SubElement(node, f"{{{self.NS}}}attvalues")
            self._add_attvalue(attvalues, "0", "theme")
            self._add_attvalue(attvalues, "1", "")
            desc = theme.get("description", "")
            self._add_attvalue(attvalues, "2", desc[:500] if desc else "")
            self._add_attvalue(attvalues, "3", str(theme.get("importance_score", 0.5)))

            # Add viz:color
            color = self.CATEGORY_COLORS["theme"]
            color_elem = ET.SubElement(node, f"{{{self.VIZ_NS}}}color")
            color_elem.set("r", str(color["r"]))
            color_elem.set("g", str(color["g"]))
            color_elem.set("b", str(color["b"]))

        # Add concept nodes
        for concept in concepts:
            node = ET.SubElement(nodes_elem, f"{{{self.NS}}}node")
            node_id = f"concept_{concept['id']}"
            node.set("id", node_id)
            node.set("label", concept.get("name", ""))

            # Add attvalues
            attvalues = ET.SubElement(node, f"{{{self.NS}}}attvalues")
            self._add_attvalue(attvalues, "0", "concept")
            category = concept.get("category", "concept")
            self._add_attvalue(attvalues, "1", category)
            definition = concept.get("definition", "")
            self._add_attvalue(attvalues, "2", definition[:500] if definition else "")
            self._add_attvalue(
                attvalues, "3", str(concept.get("importance_score", 0.5))
            )

            # Add viz:color
            color = self.CATEGORY_COLORS.get(category, self.CATEGORY_COLORS["concept"])
            color_elem = ET.SubElement(node, f"{{{self.VIZ_NS}}}color")
            color_elem.set("r", str(color["r"]))
            color_elem.set("g", str(color["g"]))
            color_elem.set("b", str(color["b"]))

        # Create edges
        edges_elem = ET.SubElement(graph, f"{{{self.NS}}}edges")
        edge_id = 0

        # Add relation edges
        for rel in relations:
            edge = ET.SubElement(edges_elem, f"{{{self.NS}}}edge")
            edge.set("id", str(edge_id))
            edge.set("source", f"concept_{rel['source_concept_id']}")
            edge.set("target", f"concept_{rel['target_concept_id']}")
            edge.set("label", rel.get("relation_type", "related_to"))

            # Add attvalues
            attvalues = ET.SubElement(edge, f"{{{self.NS}}}attvalues")
            rel_type = rel.get("relation_type", "related_to")
            self._add_attvalue(attvalues, "4", rel_type)
            self._add_attvalue(attvalues, "5", str(rel.get("strength", 0.5)))
            evidence = rel.get("evidence", "")
            self._add_attvalue(attvalues, "6", evidence[:500] if evidence else "")

            # Add viz:color
            color_hex = self.RELATION_TYPES.get(
                rel_type, self.RELATION_TYPES["related_to"]
            )["color"]
            color = self._hex_to_rgb(color_hex)
            color_elem = ET.SubElement(edge, f"{{{self.VIZ_NS}}}color")
            color_elem.set("r", str(color["r"]))
            color_elem.set("g", str(color["g"]))
            color_elem.set("b", str(color["b"]))

            edge_id += 1

        # Add theme-concept edges
        for concept in concepts:
            if concept.get("theme_id"):
                edge = ET.SubElement(edges_elem, f"{{{self.NS}}}edge")
                edge.set("id", str(edge_id))
                edge.set("source", f"theme_{concept['theme_id']}")
                edge.set("target", f"concept_{concept['id']}")
                edge.set("label", "has_concept")

                # Add attvalues
                attvalues = ET.SubElement(edge, f"{{{self.NS}}}attvalues")
                self._add_attvalue(attvalues, "4", "has_concept")
                self._add_attvalue(attvalues, "5", "1.0")
                self._add_attvalue(attvalues, "6", "")

                # Add viz:color
                color_hex = self.RELATION_TYPES["has_concept"]["color"]
                color = self._hex_to_rgb(color_hex)
                color_elem = ET.SubElement(edge, f"{{{self.VIZ_NS}}}color")
                color_elem.set("r", str(color["r"]))
                color_elem.set("g", str(color["g"]))
                color_elem.set("b", str(color["b"]))

                edge_id += 1

        # Write to file
        tree = ET.ElementTree(root)
        self._indent(root)
        tree.write(output_path, encoding="utf-8", xml_declaration=True)

        return output_path

    def _add_attribute(
        self, parent: ET.Element, attr_id: str, title: str, attr_type: str
    ) -> None:
        """Add attribute definition."""
        attr = ET.SubElement(parent, f"{{{self.NS}}}attribute")
        attr.set("id", attr_id)
        attr.set("title", title)
        attr.set("type", attr_type)

    def _add_attvalue(self, parent: ET.Element, attr_id: str, value: str) -> None:
        """Add attribute value."""
        attvalue = ET.SubElement(parent, f"{{{self.NS}}}attvalue")
        attvalue.set("for", attr_id)
        attvalue.set("value", value)

    def _hex_to_rgb(self, hex_color: str) -> dict[str, int]:
        """Convert hex color to RGB dict."""
        hex_color = hex_color.lstrip("#")
        return {
            "r": int(hex_color[0:2], 16),
            "g": int(hex_color[2:4], 16),
            "b": int(hex_color[4:6], 16),
        }

    def _indent(self, elem: ET.Element, level: int = 0) -> None:
        """Add pretty-print indentation to XML."""
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for child in elem:
                self._indent(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i
