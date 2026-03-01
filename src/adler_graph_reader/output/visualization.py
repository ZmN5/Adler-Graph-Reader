"""
Graph visualization export: Graphviz DOT and JSON formats.
"""

import json
from pathlib import Path


class GraphvizExporter:
    """Export knowledge graph to Graphviz DOT format."""

    # Node styles by category
    NODE_STYLES = {
        "theme": {"shape": "box", "style": "filled", "fillcolor": "#FFE6E6", "fontname": "Helvetica-Bold"},
        "concept": {"shape": "ellipse", "style": "filled", "fillcolor": "#E6F3FF", "fontname": "Helvetica"},
        "principle": {"shape": "ellipse", "style": "filled", "fillcolor": "#E6FFE6", "fontname": "Helvetica"},
        "method": {"shape": "ellipse", "style": "filled", "fillcolor": "#FFF5E6", "fontname": "Helvetica"},
        "tool": {"shape": "ellipse", "style": "filled", "fillcolor": "#F0E6FF", "fontname": "Helvetica"},
        "person": {"shape": "ellipse", "style": "filled", "fillcolor": "#FFE6F0", "fontname": "Helvetica-Italic"},
        "event": {"shape": "ellipse", "style": "filled", "fillcolor": "#E6FFFF", "fontname": "Helvetica"},
    }

    # Edge styles by relation type
    EDGE_STYLES = {
        "broader_than": {"color": "#FF6B6B", "style": "bold", "label_prefix": "包含"},
        "narrower_than": {"color": "#4ECDC4", "style": "bold", "label_prefix": "属于"},
        "related_to": {"color": "#95A5A6", "style": "dashed", "label_prefix": "相关"},
        "similar_to": {"color": "#3498DB", "style": "dotted", "label_prefix": "相似"},
        "prerequisite_for": {"color": "#9B59B6", "style": "bold", "label_prefix": "前置"},
        "causes": {"color": "#E74C3C", "style": "bold", "label_prefix": "导致"},
        "supports": {"color": "#27AE60", "style": "solid", "label_prefix": "支持"},
        "contradicts": {"color": "#C0392B", "style": "bold", "label_prefix": "矛盾"},
        "has_concept": {"color": "#BDC3C7", "style": "dashed", "label_prefix": ""},
    }

    def __init__(self, title: str = "Knowledge Graph"):
        self.title = title

    def export(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
        output_path: Path,
        layout: str = "dot",
    ) -> Path:
        """
        Export graph to DOT format.

        Args:
            themes: List of theme dicts with id, name, description
            concepts: List of concept dicts with id, name, definition, category
            relations: List of relation dicts with source, target, type, strength
            output_path: Output file path
            layout: Graphviz layout (dot, neato, fdp, sfdp, circo)

        Returns:
            Path to the output file
        """
        lines = [
            f'digraph "{self.title}" {{',
            '  rankdir=TB;',
            f'  layout={layout};',
            '  node [fontsize=12, margin="0.2,0.1"];',
            '  edge [fontsize=10, arrowsize=0.8];',
            '',
        ]

        # Add theme nodes
        lines.append('  // Theme nodes')
        for theme in themes:
            node_id = f"theme_{theme['id']}"
            label = self._escape(theme['name'])
            tooltip = self._escape(theme.get('description', '')[:100]) if theme.get('description') else ''
            style = self.NODE_STYLES['theme']
            style_str = self._format_style(style)
            lines.append(f'  {node_id} [{style_str} label="{label}" tooltip="{tooltip}"];')

        # Add concept nodes
        lines.append('')
        lines.append('  // Concept nodes')
        for concept in concepts:
            node_id = f"concept_{concept['id']}"
            label = self._escape(concept['name'])
            tooltip = self._escape(concept.get('definition', '')[:150])
            category = concept.get('category', 'concept')
            style = self.NODE_STYLES.get(category, self.NODE_STYLES['concept'])
            style_str = self._format_style(style)
            lines.append(f'  {node_id} [{style_str} label="{label}" tooltip="{tooltip}"];')

        # Add theme-concept edges
        lines.append('')
        lines.append('  // Theme-Concept relationships')
        for concept in concepts:
            if concept.get('theme_id'):
                source = f"theme_{concept['theme_id']}"
                target = f"concept_{concept['id']}"
                style = self.EDGE_STYLES['has_concept']
                lines.append(f'  {source} -> {target} [color={style["color"]} style={style["style"]}];')

        # Add concept-concept relations
        lines.append('')
        lines.append('  // Concept-Concept relationships')
        for rel in relations:
            source = f"concept_{rel['source_concept_id']}"
            target = f"concept_{rel['target_concept_id']}"
            rel_type = rel['relation_type']
            style = self.EDGE_STYLES.get(rel_type, self.EDGE_STYLES['related_to'])

            label = style.get('label_prefix', '')
            if label:
                label = f" {label}"

            strength = rel.get('strength', 0.5)
            penwidth = max(0.5, min(2.0, strength * 2))

            edge_attrs = [
                f'color={style["color"]}',
                f'style={style["style"]}',
                f'penwidth={penwidth}',
                f'label="{label}"',
                f'tooltip="{self._escape(rel.get("evidence", "")[:100]) if rel.get("evidence") else ""}"',
            ]

            lines.append(f'  {source} -> {target} [{" ".join(edge_attrs)}];')

        lines.append('}')

        # Write to file
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

        return output_path

    def _escape(self, text: str) -> str:
        """Escape special characters for DOT format."""
        if not text:
            return ""
        return text.replace('"', '\\"').replace('\n', '\\n').replace('<', '\\<').replace('>', '\\>')

    def _format_style(self, style: dict) -> str:
        """Format style dict as DOT attributes."""
        return ', '.join(f'{k}="{v}"' if isinstance(v, str) else f'{k}={v}' for k, v in style.items())

    def export_svg(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
        output_path: Path,
    ) -> Path:
        """
        Export graph to SVG using Graphviz.

        Requires graphviz to be installed.
        """
        import subprocess

        # First export to DOT
        dot_path = output_path.with_suffix('.dot')
        self.export(themes, concepts, relations, dot_path)

        # Convert to SVG using neato layout for better aesthetics
        svg_path = output_path.with_suffix('.svg')
        try:
            subprocess.run(
                ['neato', '-Tsvg', '-o', str(svg_path), str(dot_path)],
                check=True,
                capture_output=True,
            )
            return svg_path
        except subprocess.CalledProcessError as e:
            print(f"Warning: Graphviz neato failed: {e.stderr.decode()}")
            # Try with dot layout
            try:
                subprocess.run(
                    ['dot', '-Tsvg', '-o', str(svg_path), str(dot_path)],
                    check=True,
                    capture_output=True,
                )
                return svg_path
            except subprocess.CalledProcessError as e2:
                print(f"Warning: Graphviz dot also failed: {e2.stderr.decode()}")
                return dot_path


class GraphJSONExporter:
    """Export knowledge graph to JSON format."""

    def export(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
        output_path: Path,
        include_metadata: bool = True,
    ) -> Path:
        """
        Export graph to JSON format for visualization libraries.

        Args:
            themes: List of theme dicts
            concepts: List of concept dicts
            relations: List of relation dicts
            output_path: Output file path
            include_metadata: Whether to include full metadata

        Returns:
            Path to the output file
        """
        # Build nodes
        nodes = []

        for theme in themes:
            nodes.append({
                "id": f"theme_{theme['id']}",
                "label": theme['name'],
                "type": "theme",
                "description": theme.get('description', ''),
                "importance": theme.get('importance_score', 0.5),
            })

        for concept in concepts:
            node = {
                "id": f"concept_{concept['id']}",
                "label": concept['name'],
                "type": concept.get('category', 'concept'),
                "description": concept.get('definition', ''),
                "importance": concept.get('importance_score', 0.5),
            }
            if include_metadata:
                node["examples"] = concept.get('examples', [])
                node["explanation"] = concept.get('explanation')
            nodes.append(node)

        # Build edges
        edges = []

        # Theme-concept edges
        for concept in concepts:
            if concept.get('theme_id'):
                edges.append({
                    "source": f"theme_{concept['theme_id']}",
                    "target": f"concept_{concept['id']}",
                    "type": "has_concept",
                    "strength": 1.0,
                })

        # Concept-concept relations
        for rel in relations:
            edge = {
                "source": f"concept_{rel['source_concept_id']}",
                "target": f"concept_{rel['target_concept_id']}",
                "type": rel['relation_type'],
                "strength": rel.get('strength', 0.5),
            }
            if include_metadata:
                edge["evidence"] = rel.get('evidence', '')
                edge["explanation"] = rel.get('explanation')
            edges.append(edge)

        # Build graph structure
        graph_data = {
            "nodes": nodes,
            "edges": edges,
            "metadata": {
                "total_nodes": len(nodes),
                "total_edges": len(edges),
                "themes_count": len(themes),
                "concepts_count": len(concepts),
                "relations_count": len(relations),
            } if include_metadata else None,
        }

        # Write to file
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(graph_data, f, indent=2, ensure_ascii=False)

        return output_path

    def export_networkx(
        self,
        themes: list[dict],
        concepts: list[dict],
        relations: list[dict],
    ):
        """
        Export to NetworkX graph object.

        Requires networkx to be installed.
        """
        try:
            import networkx as nx
        except ImportError:
            raise ImportError("networkx is required: pip install networkx")

        G = nx.DiGraph()

        # Add theme nodes
        for theme in themes:
            G.add_node(
                f"theme_{theme['id']}",
                label=theme['name'],
                type='theme',
                description=theme.get('description', ''),
                importance=theme.get('importance_score', 0.5),
            )

        # Add concept nodes
        for concept in concepts:
            G.add_node(
                f"concept_{concept['id']}",
                label=concept['name'],
                type=concept.get('category', 'concept'),
                description=concept.get('definition', ''),
                importance=concept.get('importance_score', 0.5),
            )

        # Add theme-concept edges
        for concept in concepts:
            if concept.get('theme_id'):
                G.add_edge(
                    f"theme_{concept['theme_id']}",
                    f"concept_{concept['id']}",
                    type='has_concept',
                    strength=1.0,
                )

        # Add concept-concept relations
        for rel in relations:
            G.add_edge(
                f"concept_{rel['source_concept_id']}",
                f"concept_{rel['target_concept_id']}",
                type=rel['relation_type'],
                strength=rel.get('strength', 0.5),
                evidence=rel.get('evidence'),
                explanation=rel.get('explanation'),
            )

        return G
