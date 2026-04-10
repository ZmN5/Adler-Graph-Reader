# Space Sci-Fi Theme - Visual Design Specification

## Project: reader-v3 Intelligent Reading Concept Graph

---

## 1. Design Concept

**Theme Name**: Cosmic Knowledge Navigator  
**Mood**: Deep space exploration meets ancient star maps - mysterious, awe-inspiring, futuristic

The concept graph represents knowledge as a constellation of planets in a vast cosmic ocean. Each concept is a celestial body with its own gravitational pull, connected by streams of cosmic energy.

---

## 2. Color Palette

### Primary Colors (Deep Space)
| Name | Hex | Usage |
|------|-----|-------|
| Void Black | `#0a0e17` | Main background |
| Deep Space | `#0d1321` | Card backgrounds |
| Nebula Dark | `#1a1f35` | Elevated surfaces |
| Cosmic Blue | `#1e3a5f` | Secondary backgrounds |

### Accent Colors (Neon Highlights)
| Name | Hex | Usage |
|------|-----|-------|
| Plasma Cyan | `#00f5ff` | Primary accent, core concept glow |
| Nova Pink | `#ff00aa` | Secondary accent, hover states |
| Solar Orange | `#ff6b35` | Tertiary accent, warnings |
| Stellar Purple | `#8b5cf6` | Links, secondary info |
| Cosmic Teal | `#06b6d4` | Interactive elements |

### Node Category Colors
| Category | Base Color | Glow Color |
|----------|------------|------------|
| Philosophy | `#6366f1` (Indigo) | `#818cf8` |
| Science | `#10b981` (Emerald) | `#34d399` |
| History | `#f59e0b` (Amber) | `#fbbf24` |
| Art | `#ec4899` (Pink) | `#f472b6` |
| Technology | `#06b6d4` (Cyan) | `#22d3ee` |
| Politics | `#ef4444` (Red) | `#f87171` |
| Economics | `#84cc16` (Lime) | `#a3e635` |
| Psychology | `#a855f7` (Purple) | `#c084fc` |
| Core Concepts | `#00f5ff` (Cyan) | `#67e8f9` (Bright cyan glow) |
| Other | `#64748b` (Slate) | `#94a3b8` |

### Text Colors
| Usage | Color | Hex |
|-------|-------|-----|
| Primary Text | White | `#f8fafc` |
| Secondary Text | Slate 300 | `#cbd5e1` |
| Muted Text | Slate 500 | `#64748b` |

---

## 3. Typography

### Font Families
- **Display/Headings**: `Orbitron` (Google Font) - Sci-fi geometric sans-serif
- **Body Text**: `Space Grotesk` (Google Font) - Technical, readable
- **Monospace/Data**: `JetBrains Mono` (optional) - For code/numbers

### Font Sizes
- Hero: 2.5rem (40px)
- H1: 1.875rem (30px)
- H2: 1.5rem (24px)
- H3: 1.25rem (20px)
- Body: 1rem (16px)
- Small: 0.875rem (14px)
- Tiny: 0.75rem (12px)

---

## 4. Component Styles

### 4.1 Background - Starfield

**Layers**:
1. Base gradient: Radial from Deep Space center to Void Black edges
2. Static stars: 200+ small dots with varying opacity
3. Animated stars: 50 stars with gentle twinkling (opacity animation)
4. Occasional meteor: Single meteor streak every 15-30 seconds

**CSS**:
```css
background: 
  radial-gradient(ellipse at center, #0d1321 0%, #0a0e17 70%, #050810 100%);
```

### 4.2 Glass Morphism Panels

```css
background: rgba(13, 19, 33, 0.7);
backdrop-filter: blur(16px);
border: 1px solid rgba(0, 245, 255, 0.15);
box-shadow: 
  0 0 20px rgba(0, 245, 255, 0.05),
  inset 0 0 20px rgba(0, 245, 255, 0.02);
```

### 4.3 Neon Borders

```css
/* Cyan Neon */
border: 1px solid rgba(0, 245, 255, 0.4);
box-shadow: 
  0 0 5px rgba(0, 245, 255, 0.3),
  0 0 20px rgba(0, 245, 255, 0.1);

/* Pink Hover */
border: 1px solid rgba(255, 0, 170, 0.4);
box-shadow: 
  0 0 5px rgba(255, 0, 170, 0.3),
  0 0 20px rgba(255, 0, 170, 0.1);
```

### 4.4 Buttons

**Primary Button**:
```css
background: linear-gradient(135deg, rgba(0, 245, 255, 0.2), rgba(139, 92, 246, 0.2));
border: 1px solid rgba(0, 245, 255, 0.5);
color: #00f5ff;
hover:
  background: linear-gradient(135deg, rgba(0, 245, 255, 0.3), rgba(139, 92, 246, 0.3));
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.4);
  border-color: #00f5ff;
```

**Secondary Button**:
```css
background: rgba(255, 255, 255, 0.05);
border: 1px solid rgba(255, 255, 255, 0.1);
color: #cbd5e1;
```

---

## 5. Concept Graph Nodes (Planets)

### 5.1 Planet Visual Design

**Core Concepts** (Larger, Brighter):
- Size: 12-24px based on source_chunk_ids count
- Color: Plasma Cyan (#00f5ff) with radial gradient
- Glow: Pulsing cyan aura (animated)
- Ring: Optional planetary ring for very important nodes
- Animation: Gentle pulse (scale 1.0 → 1.05 → 1.0)

**Regular Concepts**:
- Size: 6-14px based on source_chunk_ids count
- Color: Category color with subtle gradient
- Glow: Small glow on hover
- Animation: None (static)

**Selected Node**:
- Bright pink border (#ff00aa)
- Enhanced glow effect
- Scale: 1.15x normal size

### 5.2 Planet Rendering

```javascript
// Planet body with gradient
const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
gradient.addColorStop(0, lightenColor(categoryColor, 30));
gradient.addColorStop(0.7, categoryColor);
gradient.addColorStop(1, darkenColor(categoryColor, 20));

// Atmosphere glow
const glowGradient = ctx.createRadialGradient(x, y, size * 0.8, x, y, size * 2.5);
glowGradient.addColorStop(0, categoryColor + '60');
glowGradient.addColorStop(1, categoryColor + '00');
```

### 5.3 Connections (Cosmic Streams)

**Normal Links**:
- Color: Gradient from source node color to target node color
- Opacity: 0.4
- Width: 1px
- Style: Dashed with small gaps (cosmic dust effect)

**Highlighted Links** (when node selected):
- Color: Plasma Cyan
- Opacity: 0.8
- Width: 2px
- Animation: Flowing particles along the line

### 5.4 Labels

- Font: Space Grotesk, 11px
- Color: #f8fafc with text-shadow for readability
- Background: Semi-transparent dark pill

---

## 6. UI Components Redesign

### 6.1 Header
- Background: Glass morphism with cyan border-bottom
- Logo/Title: Orbitron font with subtle glow
- Buttons: Ghost style with neon hover

### 6.2 Book Cards
- Background: Glass morphism
- Border: Subtle cyan on hover
- Hover: Lift with cyan glow

### 6.3 Detail Panel
- Background: Deep glass morphism
- Border-left: Cyan neon line
- Sections: Separated by subtle divider lines

### 6.4 Core Concepts List
- Card background: Glass panels
- Star icon: Animated sparkle
- Hover: Cyan border glow

---

## 7. Animations

### 7.1 Entrance Animations
```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in-up {
  animation: fadeInUp 0.5s ease-out forwards;
}
```

### 7.2 Planet Pulse
```css
@keyframes planetPulse {
  0%, 100% {
    box-shadow: 0 0 10px var(--glow-color), 0 0 20px var(--glow-color);
  }
  50% {
    box-shadow: 0 0 20px var(--glow-color), 0 0 40px var(--glow-color);
  }
}
```

### 7.3 Star Twinkle
```css
@keyframes twinkle {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
```

### 7.4 Meteor Streak
```css
@keyframes meteor {
  0% {
    transform: translateX(0) translateY(0);
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    transform: translateX(-300px) translateY(300px);
    opacity: 0;
  }
}
```

---

## 8. Responsive Breakpoints

- Mobile: < 640px (single column, simplified graph)
- Tablet: 640px - 1024px (two columns)
- Desktop: > 1024px (full three-column layout)

---

## 9. Accessibility Considerations

- Maintain WCAG AA contrast ratios for text
- Reduced motion option for users who prefer it
- Focus indicators with neon glow instead of default outline
